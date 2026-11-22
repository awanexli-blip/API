// Trendyol güvenli liste taraması (K 22.11): ürün veritabanındaki her aktif ürünü yeni mağaza kurallarından geçirir (core/ty-safe.ts).
// SALT OKUNUR: pazaryerine ve ürünlere yazmaz. Sonuç: app_state "ty_safe_report" (özet + onaya sunulacak marka listesi) ve CSV.
//   node --experimental-strip-types worker/ty-safe-scan.ts [çıktı.csv]
// Marka onayı: app_state "ty_safe_brands" (dizi). Onaylanan marka ürünlerinin fatura/yetki belgesi K'da olmalı.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { env, readAll } from "./core/util.ts";
import { tySafeCheck, parseTySafe, brandKey } from "./core/ty-safe.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const outCsv = process.argv[2] ?? "ty_safe_scan.csv";

const st = await db.from("app_state").select("key, value").in("key", ["ty_safe", "ty_safe_brands"]);
if (st.error) throw new Error(st.error.message);
const get = (k: string) => (st.data ?? []).find((x: any) => x.key === k)?.value;
const cfg = parseTySafe(get("ty_safe"));
let list: any = get("ty_safe_brands"); if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
const allowed = new Set((Array.isArray(list) ? list : []).map((b: any) => brandKey(String(b))));

const cm = await readAll<any>((a, b) => db.from("category_map").select("xml_category, category_id, marketplace").eq("marketplace", "trendyol").order("xml_category").range(a, b));
if (cm.error) throw new Error(cm.error.message);
const mapped = new Set((cm.data ?? []).filter((c: any) => c.category_id).map((c: any) => c.xml_category));
const sup = await db.from("suppliers").select("code, marketplace_brand");
const extra = (sup.data ?? []).flatMap((x: any) => [x.code, ...String(x.marketplace_brand ?? "").split("|")]).filter(Boolean);

// 1. geçiş: barkod -> ürün sayısı (çoklama), yalnızca iki kolon
const owners = new Map<string, string | 0>(); // barkod -> ilk ürün id, ikinci farklı ürün görülünce 0
const dupSet = new Set<string>();
for (let last = "00000000-0000-0000-0000-000000000000"; ;) {
  const { data, error } = await db.from("product_variants").select("id, barcode, product_id").not("barcode", "is", null).gt("id", last).order("id").limit(1000);
  if (error) throw new Error(error.message);
  for (const v of data ?? []) { const o = owners.get(v.barcode); if (o === undefined) owners.set(v.barcode, v.product_id); else if (o !== v.product_id) dupSet.add(v.barcode); }
  if (!data || data.length < 1000) break;
  last = data[data.length - 1].id;
}
owners.clear();
const dup = dupSet;

type Agg = { n: number; stocked: number; ok: number; okIfBrand: number; reasons: Record<string, number> };
const bySup: Record<string, Agg> = {};
const brands = new Map<string, { name: string; products: number; okIfBrand: number; sources: Set<string> }>();
const rows: string[] = ["kaynak;sku;barkod;marka;durum;nedenler;başlık"];
const cell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""').replace(/[\r\n;]+/g, " ")}"`;
for (let last = "00000000-0000-0000-0000-000000000000"; ;) {
  const { data, error } = await db.from("products").select("id, sku, title, description, brand, category, source, attributes, product_variants(barcode, stock, reserved), product_images(url)")
    .eq("status", "active").gt("id", last).order("id").limit(300);
  if (error) throw new Error(error.message);
  for (const p of data ?? []) {
  const vs = p.product_variants ?? [];
  const stock = Math.max(0, ...vs.map((v: any) => Number(v.stock ?? 0) - Number(v.reserved ?? 0)));
  const a = (bySup[p.source ?? "?"] ??= { n: 0, stocked: 0, ok: 0, okIfBrand: 0, reasons: {} });
  a.n++;
  if (stock < 1) continue; // stoksuz ürün zaten açılmaz
  a.stocked++;
  const manual = /\d/.test(String(p.attributes?.["Trendyol kategori"] ?? ""));
  const base = { title: p.title, description: p.description, brand: p.brand, category: p.category, barcodes: vs.map((v: any) => v.barcode ?? ""), images: (p.product_images ?? []).map((i: any) => i.url), stock };
  const c = { dupBarcodes: dup, extraPlaceholders: extra, categorySource: manual ? "manual" : mapped.has(p.category) ? "map" : "predicted", categoryMode: cfg.categoryMode, predictedHigh: false, minStock: cfg.minStock } as const;
  const why = tySafeCheck(base, { ...c, allowedBrands: cfg.brandAllowlist ? allowed : undefined });
  const whyNoBrandList = tySafeCheck(base, c); // marka onayı verilirse geçer mi
  if (!why.length) a.ok++;
  if (!whyNoBrandList.length) a.okIfBrand++;
  for (const r of why) { const k = r.split(":")[0]; a.reasons[k] = (a.reasons[k] ?? 0) + 1; }
  // Onaya sunulacak markalar: gerçek marka + tüm diğer kurallar geçiyor (yalnızca marka onayı eksik) ya da yalnızca kategori eksik
  const nonBrand = whyNoBrandList.filter((r) => !/^kategori/.test(r));
  if (!nonBrand.length && p.brand) {
    const k = brandKey(p.brand); const b = brands.get(k) ?? { name: String(p.brand).trim(), products: 0, okIfBrand: 0, sources: new Set() };
    b.products++; if (!whyNoBrandList.length) b.okIfBrand++; b.sources.add(String(p.source ?? "").replace(/^xml:/, "")); brands.set(k, b);
  }
  rows.push([p.source, p.sku, vs.map((v: any) => v.barcode).join(" "), p.brand, why.length ? "GÖNDERİLMEZ" : "UYGUN", why.join(" | "), p.title].map(cell).join(";"));
  }
  if (!data || data.length < 300) break;
  last = data[data.length - 1].id;
}
writeFileSync(outCsv, "﻿" + rows.join("\n"), "utf8");
const total = Object.values(bySup).reduce((t, a) => ({ stocked: t.stocked + a.stocked, ok: t.ok + a.ok, okIfBrand: t.okIfBrand + a.okIfBrand }), { stocked: 0, ok: 0, okIfBrand: 0 });
const brandList = [...brands.values()].sort((a, b) => b.products - a.products).map((b) => ({ name: b.name, products: b.products, readyIfApproved: b.okIfBrand, sources: [...b.sources], approved: allowed.has(brandKey(b.name)) }));
const report = { at: new Date().toISOString(), cfg, approvedBrands: allowed.size, total, bySupplier: bySup, duplicateBarcodes: dup.size, brandCandidates: brandList.length, brands: brandList.slice(0, 500) };
const w = await db.from("app_state").upsert({ key: "ty_safe_report", value: report }, { onConflict: "key" });
if (w.error) console.error("rapor yazılamadı:", w.error.message);
console.log(JSON.stringify({ ...report, brands: brandList.slice(0, 40) }, null, 1));
