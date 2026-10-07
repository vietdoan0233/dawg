import { NextRequest, NextResponse } from "next/server";

interface ExportRequestBody {
  guild_id: number;
}

export async function POST(request: NextRequest) {
  try {
    // Extract and verify bearer token from the request
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          status: "error",
          message: "Missing or invalid Authorization header",
        },
        { status: 401 }
      );
    }

    const body = await request.json() as ExportRequestBody;
    const { guild_id } = body;

    // Validate required fields
    if (!guild_id) {
      return NextResponse.json(
        {
          status: "error",
          message: "Missing required field: guild_id",
        },
        { status: 400 }
      );
    }

    // Call the Supabase Edge Function
    const functionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/export`
      : "";

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ guild_id }),
    });

    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Export failed",
      },
      { status: 400 }
    );
  }
}
