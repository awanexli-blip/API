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
// Ek linkler (feeds): adres tarayıcıya gitmez, maskeli gösterilir
const view = (s: any) => ({ ...s, xml_url: undefined, url_masked: s.url_from_env ? `GitHub Secret: ${s.url_from_env}` : mask(s.xml_url), has_url: !!(s.xml_url || s.url_from_env),
  feeds: (Array.isArray(s.feeds) ? s.feeds : []).map((f: any) => ({ id: f.id, label: f.label ?? "", sku_prefix: f.sku_prefix ?? "", mapping: f.mapping ?? null, item_path: f.item_path ?? "", url_masked: mask(f.url), has_url: !!f.url })) });
const okUrl = (u: string) => { try { const x = new URL(u.trim()); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
const mapCheck = (m: Record<string, string>) => { const v = Object.values(m); return (v.includes("model") || v.includes("variant_sku")) && v.includes("title"); };

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
  // Varsayılan özellikler: { "Menşei": "Çin" } ya da metin ("Menşei = Çin" satırları)
  if ("default_attributes" in b) {
    const src = typeof b.default_attributes === "string"
      ? Object.fromEntries(String(b.default_attributes).split(/\r?\n/).map((l) => l.split("=")).filter((x) => x.length >= 2).map(([k, ...v]) => [k.trim(), v.join("=").trim()]))
      : b.default_attributes && typeof b.default_attributes === "object" ? b.default_attributes : {};
    row.default_attributes = Object.fromEntries(Object.entries(src).filter(([k, v]) => k && v && k.length <= 60 && String(v).length <= 100).slice(0, 30).map(([k, v]) => [k, String(v)]));
  }
  if ("currency" in b) row.currency = ["TRY", "USD", "EUR"].includes(b.currency) ? b.currency : "TRY";
  if ("mapping" in b) {
    const m = b.mapping && typeof b.mapping === "object" ? b.mapping : {};
    row.mapping = Object.fromEntries(Object.entries(m).filter(([k, v]) => typeof k === "string" && k.length <= 200 && FIELDS.includes(String(v))).slice(0, 200));
    const vals = Object.values(row.mapping);
    if (!vals.includes("model") && !vals.includes("variant_sku")) return NextResponse.json({ error: "Eşlemede \"Model kodu\" alanı seçilmeli" }, { status: 400 });
    if (!vals.includes("title")) return NextResponse.json({ error: "Eşlemede \"Ürün adı\" alanı seçilmeli" }, { status: 400 });
  }
  const db = admin();
  // Ek linkler: [{ id?, label, url? (yeni/değişen), sku_prefix, mapping|null, item_path }]; adresi gönderilmeyen link kayıtlı adresini korur
  if ("feeds" in b) {
    if (!Array.isArray(b.feeds) || b.feeds.length > 10) return NextResponse.json({ error: "En fazla 10 ek link" }, { status: 400 });
    const old = b.id ? (await db.from("suppliers").select("feeds").eq("id", b.id).maybeSingle()).data?.feeds ?? [] : [];
    const byId = new Map<string, any>((Array.isArray(old) ? old : []).map((f: any) => [f.id, f]));
    const out: any[] = [];
    for (const [i, f] of (b.feeds as any[]).entries()) {
      const id = /^[a-z0-9-]{1,40}$/.test(String(f.id ?? "")) ? String(f.id) : `l${Date.now().toString(36)}${i}`;
      const url = f.url ? okUrl(String(f.url)) : byId.get(id)?.url ?? null;
      if (f.url && !url) return NextResponse.json({ error: `${i + 1}. ek link: adres http(s) ile başlamalı` }, { status: 400 });
      if (!url) return NextResponse.json({ error: `${i + 1}. ek link: XML adresi gerekli` }, { status: 400 });
      const prefix = String(f.sku_prefix ?? "").trim();
      if (!/^[A-Za-z0-9._-]{0,12}$/.test(prefix)) return NextResponse.json({ error: `${i + 1}. ek link: SKU öneki en fazla 12 karakter` }, { status: 400 });
      let mapping: Record<string, string> | null = null;
      if (f.mapping && typeof f.mapping === "object" && Object.keys(f.mapping).length) {
        mapping = Object.fromEntries(Object.entries(f.mapping).filter(([k, v]) => k.length <= 200 && FIELDS.includes(String(v))).slice(0, 200)) as Record<string, string>;
        if (!mapCheck(mapping)) return NextResponse.json({ error: `${i + 1}. ek link: eşlemede Model kodu ve Ürün adı seçilmeli` }, { status: 400 });
      }
      out.push({ id, label: String(f.label ?? "").trim().slice(0, 60) || `Link ${i + 2}`, url, sku_prefix: prefix || null, mapping, item_path: String(f.item_path ?? "").trim().slice(0, 200) || null });
    }
    row.feeds = out;
  }
  row.updated_at = new Date().toISOString();
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
