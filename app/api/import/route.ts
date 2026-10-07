import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { guild_id, csv_content } = body as {
      guild_id: number;
      csv_content: string;
    };

    // Call the Supabase Edge Function
    const functionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/import`
      : "";

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.headers.get("Authorization")?.split(" ")[1] || ""}`,
      },
      body: JSON.stringify({ guild_id, csv_content }),
    });

    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Import failed",
      },
      { status: 400 }
    );
  }
}
