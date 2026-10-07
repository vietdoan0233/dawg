import { Anthropic } from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const client = new Anthropic();
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface ColumnMapping {
  [key: string]: string;
}

interface ImportRequest {
  guild_id: number;
  csv_content: string;
  mapping?: ColumnMapping;
  confirm?: boolean;
}

interface ImportResponse {
  mapping?: ColumnMapping;
  preview?: Record<string, unknown>[];
  status: "success" | "error";
  message?: string;
}

// Parse JWT and extract user info
async function verifyToken(
  token: string,
  supabase: SupabaseClient
): Promise<{ user_id: string; email: string } | null> {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return {
      user_id: data.user.id,
      email: data.user.email || "",
    };
  } catch {
    return null;
  }
}

// Check if user is captain of the guild in current season
async function isCaptain(
  supabase: SupabaseClient,
  guild_id: number,
  user_id: string
): Promise<boolean> {
  try {
    const { data: member, error } = await supabase
      .from("members")
      .select("role")
      .eq("guild_id", guild_id)
      .eq("user_id", user_id)
      .single();

    return !error && member?.role === "captain";
  } catch {
    return false;
  }
}

// CSV parsing with proper quoted-field handling
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Mask PII in samples
function maskSample(
  value: unknown,
  columnName: string
): unknown {
  if (value === null || value === undefined) return value;
  const str = String(value);
  const lowerCol = columnName.toLowerCase();

  if (
    lowerCol.includes("email") ||
    lowerCol.includes("name") ||
    lowerCol.includes("photo") ||
    lowerCol.includes("code") ||
    lowerCol.includes("phone")
  ) {
    return `[${str.length} chars]`;
  }

  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  return `[${str.length} chars]`;
}

// Extract headers and masked samples from CSV
function parseCSVPreview(
  content: string
): { headers: string[]; samples: Record<string, unknown>[] } {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) throw new Error("Empty CSV");

  const headers = parseCSVLine(lines[0]);
  const samples: Record<string, unknown>[] = [];

  for (let i = 1; i < Math.min(lines.length, 4); i++) {
    const values = parseCSVLine(lines[i]);
    const sample: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      sample[headers[j]] = maskSample(values[j] || "", headers[j]);
    }
    samples.push(sample);
  }

  return { headers, samples };
}

// Get column mapping from Claude
async function getColumnMapping(
  headers: string[],
  samples: Record<string, unknown>[]
): Promise<ColumnMapping> {
  const prompt = `You are a CSV column mapping assistant for an onboarding import system.

Given the CSV column headers and masked sample values below, map each column to one of these target fields:
- For categories: "category_name", "color", "icon"
- For tasks: "category_name", "title", "description", "points_min", "points_max", "reviewer", "max_repeats", "required", "requires_photo", "requires_note", "revealed_at", "active"
- For tiers: "tier_name", "min_total"
- For rules: "category_name", "tier_name", "min_points"
- For members: "email", "display_name", "role", "tutor_group_name"
- For adjustments: "email", "category_name", "points", "reason"

Headers: ${JSON.stringify(headers)}

Sample rows (masked):
${JSON.stringify(samples, null, 2)}

Return a JSON object mapping each header to its target field. Only include headers that have a clear mapping.
Example: {"Name": "display_name", "Points": "points_min"}

Return ONLY valid JSON, no explanation.`;

  const message = await client.messages.create({
    model: "claude-haiku-4.5-20241001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("Failed to parse AI mapping response");
  }
}

// Parse CSV rows with proper quoted-field handling
function parseCSVRows(
  content: string,
  mapping: ColumnMapping
): Record<string, unknown>[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, unknown> = {};

    for (let j = 0; j < headers.length; j++) {
      const csvHeader = headers[j];
      const targetField = mapping[csvHeader];
      if (targetField && values[j]) {
        // Type conversion for numeric fields
        if (
          targetField === "points_min" ||
          targetField === "points_max" ||
          targetField === "max_repeats" ||
          targetField === "min_total" ||
          targetField === "points" ||
          targetField === "min_points"
        ) {
          const num = parseInt(values[j], 10);
          if (!isNaN(num)) {
            row[targetField] = num;
          }
        } else if (
          targetField === "required" ||
          targetField === "requires_photo" ||
          targetField === "requires_note" ||
          targetField === "active"
        ) {
          row[targetField] =
            values[j].toLowerCase() === "true" ||
            values[j].toLowerCase() === "yes" ||
            values[j] === "1";
        } else {
          row[targetField] = values[j];
        }
      }
    }

    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return rows;
}

// Organize rows by type
function organizeData(rows: Record<string, unknown>[]) {
  const categories: Record<string, unknown>[] = [];
  const tasks: Record<string, unknown>[] = [];
  const tiers: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  const adjustments: Record<string, unknown>[] = [];

  for (const row of rows) {
    // Detect row type by fields present
    if (row.category_name && row.title) {
      tasks.push(row);
    } else if (row.tier_name && row.min_total) {
      tiers.push(row);
    } else if (row.category_name && row.min_points && !row.title) {
      rules.push(row);
    } else if (row.email && row.display_name && (row.role || row.tutor_group_name)) {
      members.push(row);
    } else if (row.email && row.category_name && typeof row.points === "number") {
      adjustments.push(row);
    } else if (row.category_name && (row.color || row.icon)) {
      categories.push(row);
    }
  }

  return { categories, tasks, tiers, rules, members, adjustments };
}

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Missing or invalid Authorization header",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const token = authHeader.slice(7); // Remove "Bearer " prefix
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify JWT token
    const user = await verifyToken(token, supabase);
    if (!user) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Invalid or expired token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as ImportRequest;
    const { guild_id, csv_content, mapping, confirm } = body;

    // Verify captain role
    const isCaptainUser = await isCaptain(supabase, guild_id, user.user_id);
    if (!isCaptainUser) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Only guild captains can import data",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 1: Generate mapping preview
    if (!mapping || !confirm) {
      if (!csv_content) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: "Missing csv_content",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const { headers, samples } = parseCSVPreview(csv_content);
      if (headers.length === 0) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: "CSV has no headers",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const generatedMapping = await getColumnMapping(headers, samples);

      return new Response(
        JSON.stringify({
          mapping: generatedMapping,
          preview: samples,
          status: "success",
        } as ImportResponse),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Step 2: Apply import with confirmed mapping
    if (confirm && mapping) {
      if (!csv_content) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: "Missing csv_content",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const rows = parseCSVRows(csv_content, mapping);
      if (rows.length === 0) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: "CSV has no data rows",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const { categories, tasks, tiers, rules, members, adjustments } =
        organizeData(rows);

      // Call import_apply RPC with authenticated user context
      const { data, error } = await supabase.rpc("import_apply", {
        p_guild_id: guild_id,
        p_categories: categories,
        p_tasks: tasks,
        p_tiers: tiers,
        p_rules: rules,
        p_members: members,
        p_adjustments: adjustments,
      });

      if (error) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: `Import failed: ${error.message}`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          status: "success",
          message: `Import successful`,
          data,
        } as ImportResponse),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        status: "error",
        message: "Invalid request: missing mapping or confirm flag",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return new Response(
      JSON.stringify({
        status: "error",
        message,
      } as ImportResponse),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
