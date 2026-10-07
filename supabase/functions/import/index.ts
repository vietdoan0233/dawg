import { Anthropic } from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const client = new Anthropic();
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

interface ColumnMapping {
  [key: string]: string; // CSV header -> target field
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

// Helper to safely mask PII (names, emails, photos, roster values)
function maskSample(
  value: unknown,
  columnName: string
): unknown {
  if (value === null || value === undefined) return value;
  const str = String(value);
  const lowerCol = columnName.toLowerCase();

  // Never expose names, emails, photos, or raw roster values
  if (
    lowerCol.includes("email") ||
    lowerCol.includes("name") ||
    lowerCol.includes("photo") ||
    lowerCol.includes("code") ||
    lowerCol.includes("phone")
  ) {
    return `[${str.length} chars]`;
  }

  // Numbers and other fields: keep shape but mask content
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

  const headers = lines[0].split(",").map((h) => h.trim());
  const samples: Record<string, unknown>[] = [];

  for (let i = 1; i < Math.min(lines.length, 4); i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const sample: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      sample[headers[j]] = maskSample(values[j] || "", headers[j]);
    }
    samples.push(sample);
  }

  return { headers, samples };
}

// Call Claude to map CSV columns to import fields
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

// Parse CSV rows based on column mapping
function parseCSVRows(
  content: string,
  mapping: ColumnMapping
): Record<string, unknown>[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, unknown> = {};

    for (let j = 0; j < headers.length; j++) {
      const csvHeader = headers[j];
      const targetField = mapping[csvHeader];
      if (targetField && values[j]) {
        row[targetField] = values[j];
      }
    }

    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return rows;
}

// Organize rows by type (categories, tasks, tiers, rules, members, adjustments)
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
    } else if (row.email && row.category_name && row.points && row.reason) {
      adjustments.push(row);
    } else if (row.category_name && row.color) {
      categories.push(row);
    }
  }

  return { categories, tasks, tiers, rules, members, adjustments };
}

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");

  // Verify authenticated user token
  if (!authHeader || !authHeader.includes("Bearer ")) {
    return new Response(
      JSON.stringify({ status: "error", message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = (await req.json()) as ImportRequest;

    // Step 1: Generate mapping preview
    if (!body.mapping) {
      const { headers, samples } = parseCSVPreview(body.csv_content);
      const mapping = await getColumnMapping(headers, samples);

      return new Response(
        JSON.stringify({
          mapping,
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
    if (body.confirm && body.mapping) {
      const rows = parseCSVRows(body.csv_content, body.mapping);
      const { categories, tasks, tiers, rules, members, adjustments } =
        organizeData(rows);

      // Call import_apply RPC
      const { data, error } = await supabase.rpc("import_apply", {
        p_guild_id: body.guild_id,
        p_categories: categories,
        p_tasks: tasks,
        p_tiers: tiers,
        p_rules: rules,
        p_members: members,
        p_adjustments: adjustments,
      });

      if (error) {
        throw new Error(`Import failed: ${error.message}`);
      }

      return new Response(
        JSON.stringify({
          status: "success",
          message: `Import successful: ${JSON.stringify(data)}`,
        } as ImportResponse),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    throw new Error("Invalid request: missing mapping or confirm flag");
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
