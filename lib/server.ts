import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { resolveRole, type Role } from "./auth-rules.ts";

// Tek service_role istemcisi (modül düzeyinde, her çağrıda yeniden kurulmaz)
const make = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let client: ReturnType<typeof make> | null = null;
export const admin = () => (client ??= make());

// Rol bazlı erişim: ADMIN_EMAIL her zaman admin; diğer kullanıcılar user_roles tablosundan. E-postası doğrulanmamış kullanıcı reddedilir.
export type { Role };
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };
export type Actor = { email: string; role: Role };

export async function getActor(req: NextRequest): Promise<Actor | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data } = await admin().auth.getUser(token);
  return resolveRole(data.user, process.env.ADMIN_EMAIL, async (email) => {
    const { data: r } = await admin().from("user_roles").select("role").eq("email", email).maybeSingle();
    return ((r as any)?.role as Role) ?? null;
  });
}

// En az bu role sahip kullanıcıyı döndürür, yoksa null
export async function requireRole(req: NextRequest, min: Role): Promise<Actor | null> {
  const a = await getActor(req);
  return a && RANK[a.role] >= RANK[min] ? a : null;
}

// Pazaryeri ve ayar rotaları: yalnızca admin (eski davranış: ADMIN_EMAIL)
export async function guard(req: NextRequest): Promise<boolean> {
  return !!(await requireRole(req, "admin"));
}

export const forbidden = (need: Role) => NextResponse.json({ error: `Bu işlem için "${need}" yetkisi gerekli` }, { status: 403 });

// Kimliksiz isteğe yapılandırma ayrıntısı (eksik ortam değişkeni adları) söylenmez; ayrıntı sunucu günlüğünde ve /api/health'te (yalnızca admin)
export const unauthorized = () => {
  const missing = ["ADMIN_EMAIL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) console.error(`Vercel ortam değişkeni eksik: ${missing.join(", ")}`);
  return NextResponse.json({ error: "Yetkisiz: giriş yaptığın e-posta doğrulanmamış ya da bu panelde rolü yok" }, { status: 401 });
};
export const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export const MARKETPLACES = ["trendyol", "hepsiburada", "amazon"]; // worker/marketplaces/index.ts ile aynı tutulur
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
