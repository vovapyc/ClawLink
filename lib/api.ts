import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function errorResponse(status: number, code: string, message?: string) {
  return NextResponse.json(
    { error: code, message: message ?? code },
    { status }
  );
}

export function zodErrorResponse(err: ZodError) {
  return NextResponse.json(
    {
      error: "invalid_request",
      message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    },
    { status: 400 }
  );
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
