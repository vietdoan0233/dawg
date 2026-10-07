import { NextRequest, NextResponse } from "next/server";

interface ImportRequestBody {
  guild_id: number;
  csv_content: string;
  mapping?: Record<string, string>;
  confirm?: boolean;
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

    const body = await request.json() as ImportRequestBody;
    const { guild_id, csv_content, mapping, confirm } = body;

    // Validate required fields
    if (!guild_id || !csv_content) {
      return NextResponse.json(
        {
          status: "error",
          message: "Missing required fields: guild_id and csv_content",
        },
        { status: 400 }
      );
    }

    // Call the Supabase Edge Function, passing the entire body and auth header
    const functionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/import`
      : "";

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ guild_id, csv_content, mapping, confirm }),
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
