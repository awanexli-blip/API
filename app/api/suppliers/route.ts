import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";
import { FIELD_LABEL } from "@/lib/import";

export const dynamic = "force-dynamic";

const FIELDS = Object.keys(FIELD_LABEL);
// XML adresi tarayıcıya tam gitmez (içinde anahtar olabilir)
const mask = (u?: string | null) => {
  if (!u) return "";
  try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname.length > 1 ? "/…" : ""}${x.search ? "?…" : ""}`; } catch { return "…"; }
};
const view = (s: any) => ({ ...s, xml_url: undefined, url_masked: s.url_from_env ? `GitHub Secret: ${s.url_from_env}` : mask(s.xml_url), has_url: !!(s.xml_url || s.url_from_env) });

export async function GET(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const db = admin();
  const { data, error } = await db.from("suppliers").select("*").order("created_at");
  if (error) return dbError(error);
  // Tedarikçi başına ürün sayısı (sayım sorgusu, satır çekmez)
  const counts = await Promise.all((data ?? []).map((s) => db.from("products").select("id", { count: "exact", head: true }).eq("source", `xml:${s.code}`)));
  return NextResponse.json((data ?? []).map((s, i) => ({ ...view(s), product_count: counts[i].count ?? 0 })));
}

// Oluştur / güncelle: { id?, code, name, xml_url?, active, nightly, item_path, mapping, sku_prefix, sku_ascii, price_includes_vat, default_vat, default_brand, currency }
export async function PUT(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  const row: any = {};
  if (!b.id) {
    const code = String(b.code ?? "").toLowerCase().trim();
    if (!/^[a-z0-9-]{2,30}$/.test(code)) return NextResponse.json({ error: "Kısa kod 2-30 karakter: küçük harf, rakam, tire (ör. tedarikci-2)" }, { status: 400 });
    row.code = code;
  }
  if ("name" in b) { row.name = String(b.name ?? "").trim().slice(0, 80); if (!row.name) return NextResponse.json({ error: "Ad gerekli" }, { status: 400 }); }
  if (b.xml_url) {
    try { const u = new URL(String(b.xml_url).trim()); if (!/^https?:$/.test(u.protocol)) throw 0; row.xml_url = u.toString(); row.url_from_env = null; }
    catch { return NextResponse.json({ error: "XML adresi http(s) ile başlamalı" }, { status: 400 }); }
  }
  for (const k of ["active", "nightly", "sku_ascii", "price_includes_vat"]) if (k in b) row[k] = !!b[k];
  if ("item_path" in b) row.item_path = String(b.item_path ?? "").trim().slice(0, 200) || null;
  if ("sku_prefix" in b) {
    row.sku_prefix = String(b.sku_prefix ?? "").trim();
    if (!/^[A-Za-z0-9._-]{0,12}$/.test(row.sku_prefix)) return NextResponse.json({ error: "SKU öneki en fazla 12 karakter: harf, rakam, . _ -" }, { status: 400 });
  }
  if ("default_vat" in b) row.default_vat = [0, 1, 10, 20].includes(Number(b.default_vat)) ? Number(b.default_vat) : 20;
  if ("default_brand" in b) row.default_brand = String(b.default_brand ?? "").trim().slice(0, 100);
  if ("marketplace_brand" in b) row.marketplace_brand = String(b.marketplace_brand ?? "").trim().slice(0, 100) || null;
  if ("currency" in b) row.currency = ["TRY", "USD", "EUR"].includes(b.currency) ? b.currency : "TRY";
  if ("mapping" in b) {
    const m = b.mapping && typeof b.mapping === "object" ? b.mapping : {};
    row.mapping = Object.fromEntries(Object.entries(m).filter(([k, v]) => typeof k === "string" && k.length <= 200 && FIELDS.includes(String(v))).slice(0, 200));
    const vals = Object.values(row.mapping);
    if (!vals.includes("model") && !vals.includes("variant_sku")) return NextResponse.json({ error: "Eşlemede \"Model kodu\" alanı seçilmeli" }, { status: 400 });
    if (!vals.includes("title")) return NextResponse.json({ error: "Eşlemede \"Ürün adı\" alanı seçilmeli" }, { status: 400 });
  }
  row.updated_at = new Date().toISOString();
  const db = admin();
  const q = b.id ? db.from("suppliers").update(row).eq("id", b.id) : db.from("suppliers").insert(row);
  const { data, error } = await q.select("*").single();
  if (error) return error.code === "23505" ? NextResponse.json({ error: "Bu kısa kod zaten kullanılıyor" }, { status: 409 }) : dbError(error);
  return NextResponse.json(view(data));
}

// Silme: tedarikçi kaydı silinir, ürünleri kalır (ayrıca arşivlenebilir)
export async function DELETE(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
  const { error } = await admin().from("suppliers").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
