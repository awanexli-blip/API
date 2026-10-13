import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { data, error } = await admin().from("sync_runs").select("*").order("id", { ascending: false }).limit(20);
  if (error) return bad(error.message);
  return NextResponse.json(data);
}
