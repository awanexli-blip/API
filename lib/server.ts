import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const admin = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// Yalnızca ADMIN_EMAIL ile giriş yapmış kullanıcı geçer.
export async function guard(req: NextRequest): Promise<boolean> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !process.env.ADMIN_EMAIL) return false;
  const { data } = await admin().auth.getUser(token);
  return data.user?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
}

export const unauthorized = () => NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
export const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
