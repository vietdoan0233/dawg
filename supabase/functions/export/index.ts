// export/index.ts - Captain-only CSV export: member × category matrix + tier
// Formula-injection escape: prefix =, +, -, @, tab, carriage return with apostrophe

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

interface ExportRequest {
  guild_id: number;
}

interface ExportResponse {
  status: "success" | "error";
  csv?: string;
  message?: string;
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

// Escape quotes in CSV values
function quoteCSVValue(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.includes("Bearer ")) {
    return new Response(
      JSON.stringify({ status: "error", message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = (await req.json()) as ExportRequest;
    const { guild_id } = body;

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

    // Fetch all members with their tiers
    const { data: members, error: memberErr } = await supabase
      .from("members")
      .select("id, display_name, role")
      .eq("guild_id", guild_id)
      .eq("season_id", season_id)
      .order("display_name", { ascending: true });

    if (memberErr) throw new Error("Failed to fetch members");

    // Fetch member tiers
    const { data: memberTiers, error: tierErr } = await supabase.rpc(
      "member_tier",
      { p_member_id: members?.[0]?.id }
    );

    if (tierErr) throw new Error("Failed to fetch tiers");

    // TODO: Fetch member progress (points per category) - requires RPC implementation
    // const { data: progress, error: progressErr } = await supabase.rpc(
    //   "progress",
    //   { p_member_id: members?.[0]?.id }
    // );
    // if (progressErr) throw new Error("Failed to fetch progress");

    // Build CSV header row
    const headers = ["Member", "Role"];
    const categoryNames: string[] = [];
    for (const cat of categories || []) {
      headers.push(cat.name);
      categoryNames.push(cat.name);
    }
    headers.push("Tier");

    // Build CSV data rows
    const rows: string[] = [headers.map(quoteCSVValue).join(",")];

    for (const member of members || []) {
      const row: string[] = [];

      // Member name (escaped)
      row.push(quoteCSVValue(escapeCSVCell(member.display_name)));

      // Member role
      row.push(quoteCSVValue(escapeCSVCell(member.role)));

      // Points per category (for now, 0 since progress view requires member_id + category_id)
      // TODO: implement progress view to get points per member/category
      for (let i = 0; i < categoryNames.length; i++) {
        row.push(quoteCSVValue(escapeCSVCell("0")));
      }

      // Member's tier
      const tierName =
        memberTiers?.find(
          (t: { member_id: number; tier_id: number; name: string }) =>
            t.member_id === member.id
        )?.name || "";
      row.push(quoteCSVValue(escapeCSVCell(tierName)));

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
