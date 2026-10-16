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

// Nedeni açıkça söyle: eksik ortam değişkeni panelde "Yetkisiz" diye sessizce görünmesin
export const unauthorized = () => {
  const missing = ["ADMIN_EMAIL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  const error = missing.length
    ? `Vercel ortam değişkeni eksik: ${missing.join(", ")}. Vercel > Settings > Environment Variables'a ekleyip yeniden dağıt.`
    : "Yetkisiz: giriş yaptığın e-posta Vercel'deki ADMIN_EMAIL ile aynı değil";
  return NextResponse.json({ error }, { status: 401 });
};
export const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export const MARKETPLACES = ["trendyol", "hepsiburada"]; // worker/marketplaces/index.ts ile aynı tutulur
export const mpOf = (req: NextRequest) => {
  const m = req.nextUrl.searchParams.get("mp") ?? "trendyol";
  return MARKETPLACES.includes(m) ? m : null;
};

// Pazaryerine ait tablo satırları. Migration 002 çalıştırılmadıysa Trendyol filtresiz okur.
export async function mpSelect(table: string, mp: string, order: string, ascending = true) {
  const db = admin();
  const r = await db.from(table).select("*").eq("marketplace", mp).order(order, { ascending });
  if (!r.error) return { data: r.data ?? [], migrated: true as const };
  if (mp !== "trendyol") return { error: `Supabase migration 002 çalıştırılmamış (${r.error.message})` };
  const r2 = await db.from(table).select("*").order(order, { ascending });
  return r2.error ? { error: r2.error.message } : { data: r2.data ?? [], migrated: false as const };
}
