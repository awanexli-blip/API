import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";
const ROLES = ["viewer", "editor", "admin"];

// Kullanıcılar ve roller (yalnızca yönetici). ADMIN_EMAIL her zaman yöneticidir ve listede kilitli görünür.
export async function GET(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const { data, error } = await admin().from("user_roles").select("email, role, created_at").order("created_at");
  if (error) return dbError(error);
  const owner = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const rows = (data ?? []).filter((r) => r.email !== owner);
  return NextResponse.json([...(owner ? [{ email: owner, role: "admin", owner: true }] : []), ...rows]);
}

// { email, role, invite?: true } -> rol ver; invite ile Supabase davet e-postası gönderilir (hesabı yoksa)
export async function PUT(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Geçerli bir e-posta gir" }, { status: 400 });
  if (!ROLES.includes(b.role)) return NextResponse.json({ error: "Geçersiz rol" }, { status: 400 });
  if (email === (process.env.ADMIN_EMAIL ?? "").toLowerCase()) return NextResponse.json({ error: "Ana yönetici (ADMIN_EMAIL) değiştirilemez" }, { status: 400 });
  const db = admin();
  const { error } = await db.from("user_roles").upsert({ email, role: b.role });
  if (error) return dbError(error);
  let invited: string | null = null;
  if (b.invite) {
    const r = await db.auth.admin.inviteUserByEmail(email, { redirectTo: req.nextUrl.origin });
    invited = r.error ? (/already|registered|exists/i.test(r.error.message) ? "Bu e-postanın zaten hesabı var" : r.error.message) : "Davet e-postası gönderildi";
  }
  return NextResponse.json({ ok: true, invited });
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const email = String(req.nextUrl.searchParams.get("email") ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "email gerekli" }, { status: 400 });
  if (email === a.email) return NextResponse.json({ error: "Kendi yetkini kaldıramazsın" }, { status: 400 });
  const { error } = await admin().from("user_roles").delete().eq("email", email);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
