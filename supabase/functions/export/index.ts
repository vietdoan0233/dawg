import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface ExportRequest {
  guild_id: number;
}

interface ExportResponse {
  status: "success" | "error";
  csv?: string;
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

// Check if user is captain of the guild
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

// Escape cells for formula injection safety
function escapeCSVCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const str = String(value);

  // Escape formula injection: prefix =, +, -, @, tab, carriage return with '
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

// Quote and escape CSV values
function quoteCSVValue(value: string): string {
  const escaped = escapeCSVCell(value);
  if (
    escaped.includes('"') ||
    escaped.includes(",") ||
    escaped.includes("\n") ||
    escaped.includes("\r")
  ) {
    return '"' + escaped.replace(/"/g, '""') + '"';
  }
  return escaped;
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

    const body = (await req.json()) as ExportRequest;
    const { guild_id } = body;

    // Verify captain role
    const isCaptainUser = await isCaptain(supabase, guild_id, user.user_id);
    if (!isCaptainUser) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Only guild captains can export data",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get current season for this guild
    const { data: season, error: seasonErr } = await supabase
      .from("seasons")
      .select("id")
      .eq("guild_id", guild_id)
      .eq("is_current", true)
      .single();

    if (seasonErr || !season) {
      throw new Error("No current season for guild");
    }

    const season_id = season.id;

    // Fetch all categories ordered by id (display order per SDD)
    const { data: categories, error: catErr } = await supabase
      .from("categories")
      .select("id, name")
      .eq("guild_id", guild_id)
      .eq("season_id", season_id)
      .order("id", { ascending: true });

    if (catErr) throw new Error("Failed to fetch categories");

    // Fetch all members
    const { data: members, error: memberErr } = await supabase
      .from("members")
      .select("id, display_name, role")
      .eq("guild_id", guild_id)
      .eq("season_id", season_id)
      .order("display_name", { ascending: true });

    if (memberErr) throw new Error("Failed to fetch members");

    // Fetch progress data (points per member per category)
    const { data: progressData, error: progressErr } = await supabase
      .from("progress")
      .select("member_id, category_id, points")
      .in("member_id", members?.map((m) => m.id) || []);

    if (progressErr) throw new Error("Failed to fetch progress data");

    // Fetch member tiers (member_id, tier_id)
    const { data: memberTierMap, error: tierErr } = await supabase
      .from("member_tier")
      .select("member_id, tier_id")
      .in("member_id", members?.map((m) => m.id) || []);

    if (tierErr) throw new Error("Failed to fetch member tiers");

    // Fetch tier names (id, name)
    const { data: tiers, error: tierNamesErr } = await supabase
      .from("tiers")
      .select("id, name")
      .eq("guild_id", guild_id)
      .eq("season_id", season_id);

    if (tierNamesErr) throw new Error("Failed to fetch tier names");

    // Build lookup maps for efficient access
    const progressMap = new Map<string, number>();
    for (const p of progressData || []) {
      progressMap.set(`${p.member_id}:${p.category_id}`, p.points || 0);
    }

    const tierMap = new Map<number, string>();
    for (const t of tiers || []) {
      tierMap.set(t.id, t.name);
    }

    const memberTierMap_ = new Map<number, number>();
    for (const mt of memberTierMap || []) {
      memberTierMap_.set(mt.member_id, mt.tier_id);
    }

    // Build CSV header row with escaped category names
    const headers = ["Member", "Role"];
    const categoryIds: number[] = [];
    for (const cat of categories || []) {
      headers.push(quoteCSVValue(cat.name));
      categoryIds.push(cat.id);
    }
    headers.push("Tier");

    // Build CSV data rows
    const rows: string[] = [headers.join(",")];

    for (const member of members || []) {
      const row: string[] = [];

      // Member name (escaped and quoted)
      row.push(quoteCSVValue(member.display_name));

      // Member role (escaped and quoted)
      row.push(quoteCSVValue(member.role));

      // Points per category (from progress view)
      for (const catId of categoryIds) {
        const points = progressMap.get(`${member.id}:${catId}`) || 0;
        row.push(quoteCSVValue(String(points)));
      }

      // Member's tier name
      const tierId = memberTierMap_.get(member.id);
      const tierName = tierId ? tierMap.get(tierId) : "";
      row.push(quoteCSVValue(tierName || ""));

      rows.push(row.join(","));
    }

    const csv = rows.join("\n");

    const response: ExportResponse = {
      status: "success",
      csv,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: ExportResponse = {
      status: "error",
      message,
    };

    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
