import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf } from "@/lib/server";
import { readAll } from "@/worker/core/util";

export const dynamic = "force-dynamic";

// Reddedilen ürünler (Trendyol): ret nedeni + düzeltme durumu + mağaza kategorileri + yasaklı kelimeler
export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const db = admin();
  const [ls, fx, cats, bw] = await Promise.all([
    db.from("marketplace_listings").select("listing_key, title, last_error, product_id, updated_at").eq("marketplace", mp).eq("status", "rejected").order("updated_at", { ascending: false }).limit(500),
    readAll((a, b) => db.from("listing_fixes").select("*").eq("marketplace", mp).order("listing_key").range(a, b)),
    db.rpc("store_categories", { mp }),
    readAll((a, b) => db.from("banned_words").select("word, source, created_at").eq("marketplace", mp).order("created_at", { ascending: false }).order("word").range(a, b)),
  ]);
  if (ls.error) return bad(ls.error.message);
  const fixes = new Map((fx.data ?? []).map((f: any) => [f.listing_key, f]));
  const items = (ls.data ?? []).map((l: any) => ({ ...l, fix: fixes.get(l.listing_key) ?? null }));
  // Yeniden gönderilip onay bekleyenler (listede artık "rejected" değil)
  const inReview = (fx.data ?? []).filter((f: any) => f.status === "resubmitted" && !items.some((i: any) => i.listing_key === f.listing_key)).length;
  return NextResponse.json({ items, inReview, categories: cats.data ?? [], banned: bw.data ?? [] });
}

// { listing_key, action: "resubmit" | "giveup" | "auto", title?, description?, category_id?, category_name?, images? }
// resubmit: kullanıcı düzeltmesi bir sonraki senkronda gönderilir · auto: sisteme bırak · giveup: bir daha deneme
export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => ({}));
  const key = String(b.listing_key ?? "");
  if (!key) return bad("listing_key gerekli");
  const db = admin();
  const { data: cur } = await db.from("listing_fixes").select("*").eq("marketplace", mp).eq("listing_key", key).maybeSingle();
  const proposed: any = { ...(cur?.proposed ?? {}) };
  if (b.title != null) { const t = String(b.title).trim(); if (t.length > 100) return bad("Başlık en fazla 100 karakter"); proposed.title = t || undefined; }
  if (b.description != null) proposed.description = String(b.description).slice(0, 30000) || undefined;
  if (b.category_id != null) { proposed.category_id = String(b.category_id) || undefined; proposed.category_name = b.category_name ? String(b.category_name) : undefined; }
  if (Array.isArray(b.images)) {
    const imgs = b.images.map(String).filter((u: string) => /^https:\/\//.test(u)).slice(0, 8);
    proposed.images = imgs.length ? imgs : undefined;
  }
  const status = b.action === "giveup" ? "gave_up" : b.action === "auto" ? "auto" : "user_ready";
  if (status === "user_ready" && !proposed.title && !proposed.description && !proposed.category_id && !proposed.images) return bad("Gönderilecek bir düzeltme yok: başlık, açıklama, kategori veya görsel değiştir");
  const { error } = await db.from("listing_fixes").upsert({ marketplace: mp, listing_key: key, proposed, status, attempts: cur?.attempts ?? 0, types: cur?.types ?? [], details: cur?.details ?? null, note: status === "user_ready" ? "kullanıcı düzeltti, sonraki senkronda gönderilecek" : status === "gave_up" ? "vazgeçildi" : "otomatik düzeltmeye bırakıldı", last_attempt_at: status === "auto" ? null : cur?.last_attempt_at ?? null, updated_at: new Date().toISOString() }, { onConflict: "marketplace,listing_key" });
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true, status });
}

// Yasaklı kelime ekle / sil: POST { word } · DELETE ?word=
export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => ({}));
  const word = String(b.word ?? "").trim().toLocaleLowerCase("tr");
  if (word.length < 2 || word.length > 60) return bad("Kelime 2-60 karakter olmalı");
  const { error } = await admin().from("banned_words").upsert({ marketplace: mp, word, source: "elle" }, { onConflict: "marketplace,word" });
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  const word = req.nextUrl.searchParams.get("word");
  if (!mp || !word) return bad("word gerekli");
  const { error } = await admin().from("banned_words").delete().eq("marketplace", mp).eq("word", word);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
