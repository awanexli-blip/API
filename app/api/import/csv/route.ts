import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";
import { errorRow, groupToPayload, type Group } from "@/lib/import";
import { generateEan13, generateSku, issuesByPath, productSchema } from "@/lib/validation/product";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODES = ["create", "update", "upsert"] as const;
type Result = { row: number; sku: string; status: string; errors?: Record<string, string>; product_id?: string };

const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
// İçerik özeti (stok hariç): aynı dosya tekrar yüklenirse yalnızca stok güncellenir
const hashOf = (p: any) => createHash("sha1").update(stable({ ...p, variants: (p.variants ?? []).map(({ stock, ...v }: any) => v) })).digest("hex");
const slug = (s: string) => s.toLocaleUpperCase("tr").replace(/Ç/g, "C").replace(/Ğ/g, "G").replace(/İ/g, "I").replace(/Ö/g, "O").replace(/Ş/g, "S").replace(/Ü/g, "U").replace(/[^A-Z0-9]+/g, "").slice(0, 8);

// Gövde: { job_id?, filename, mode, dry_run, final, groups: Group[] } (en fazla 500 satır/istek)
export async function POST(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => null);
  const mode = MODES.includes(b?.mode) ? b.mode : "upsert";
  const groups: Group[] = Array.isArray(b?.groups) ? b.groups : [];
  if (!groups.length) return NextResponse.json({ error: "Satır yok" }, { status: 400 });
  if (groups.reduce((t, g) => t + (g.rows?.length ?? 0), 0) > 1000) return NextResponse.json({ error: "İstek başına en fazla 1000 satır" }, { status: 400 });
  const db = admin();

  const parts = groups.map((g) => ({ g, p: groupToPayload(g) as Record<string, any> }));
  const skus = [...new Set(parts.map((x) => x.p.sku).filter(Boolean))];
  const existing = new Map<string, any>();
  for (let i = 0; i < skus.length; i += 200) {
    const { data, error } = await db.from("products").select("*, product_variants(*), product_images(url, position)").in("sku", skus.slice(i, i + 200));
    if (error) return dbError(error);
    for (const p of data ?? []) existing.set(p.sku, p);
  }

  const results: Result[] = [];
  const items: { row: number; payload: any; hash: string }[] = [];
  for (const { g, p } of parts) {
    const row = g.rows[0].row;
    const fail = (errors: Record<string, string>, status = "error") => results.push({ row, sku: p.sku ?? "", status, errors });
    if (!p.sku) {
      if (mode === "update") { fail({ sku: "Model kodu yok (güncelleme modunda gerekli)" }); continue; }
      p.sku = generateSku(p.title ?? "");
    }
    const ex = existing.get(p.sku);
    if (ex && mode === "create") { fail({ sku: "Bu model kodu zaten var (yalnızca ekleme modu)" }, "skipped"); continue; }
    if (!ex && mode === "update") { fail({ sku: "Ürün bulunamadı (yalnızca güncelleme modu)" }, "skipped"); continue; }

    // Varyant SKU / barkod: yeni varyantlarda otomatik
    const exVars: any[] = ex ? [...ex.product_variants].sort((x: any, y: any) => x.position - y.position) : [];
    const many = p.variants.length > 1;
    p.variants.forEach((v: any, i: number) => {
      if (!v.sku) {
        if (ex && exVars.length === 1 && p.variants.length === 1) v.sku = exVars[0].sku;
        else v.sku = many ? `${p.sku}-${Object.values(v.attributes ?? {}).map((x: any) => slug(String(x))).filter(Boolean).join("-") || i + 1}` : p.sku;
      }
      const known = exVars.find((x) => x.sku === v.sku);
      if (!known && !v.barcode) v.barcode = generateEan13();
      if (!known && v.stock == null) v.stock = "0";
    });

    // Doğrulama: mevcut ürünle birleşmiş hâli (dosyada olmayan alanlar korunur)
    const base = ex ? {
      sku: ex.sku, title: ex.title, description: ex.description, brand: ex.brand, category: ex.category, vat_rate: ex.vat_rate, desi: ex.desi,
      cost_price: ex.cost_price, currency: ex.currency, status: ex.status, attributes: ex.attributes,
      images: [...ex.product_images].sort((x: any, y: any) => x.position - y.position).map((i: any) => i.url),
    } : { status: "active" };
    const mergedVariants = [
      ...p.variants.map((v: any) => ({ ...(exVars.find((x) => x.sku === v.sku) ?? {}), ...v })),
      ...exVars.filter((x) => !p.variants.some((v: any) => v.sku === x.sku)),
    ].map((v: any) => ({ sku: v.sku, barcode: v.barcode, attributes: v.attributes ?? {}, stock: v.stock, cost_price: v.cost_price }));
    const parsed = productSchema.safeParse({ ...base, ...p, variants: mergedVariants });
    if (!parsed.success) {
      const errs = issuesByPath(parsed.error);
      // Satır numarasına göre grupla
      const byRow = new Map<number, Record<string, string>>();
      for (const [path, msg] of Object.entries(errs)) {
        const r = errorRow(g, path);
        byRow.set(r, { ...(byRow.get(r) ?? {}), [path.replace(/^variants\.\d+\./, "")]: msg });
      }
      for (const [r, e] of byRow) results.push({ row: r, sku: p.sku, status: "error", errors: e });
      continue;
    }
    // Veritabanına giden: yeni üründe tam kayıt; mevcutta yalnızca dosyadaki alanlar (tipleri düzeltilmiş)
    const d: any = parsed.data;
    const payload: any = ex ? Object.fromEntries(Object.keys(p).filter((k) => k !== "variants").map((k) => [k, d[k]])) : { ...d };
    payload.sku = d.sku;
    payload.variants = d.variants.slice(0, p.variants.length).map((v: any, i: number) => ex ? Object.fromEntries(Object.keys(p.variants[i]).map((k) => [k, v[k]])) : v);
    if (!ex) payload.source = "csv";
    items.push({ row, payload, hash: hashOf(payload) });
    results.push({ row, sku: d.sku, status: ex ? "update" : "create" });
  }

  if (b.dry_run) return NextResponse.json({ results });

  // İş kaydı (ilk istekte oluşur, sonrakiler aynı işe eklenir)
  let jobId: number = Number(b.job_id) || 0;
  if (!jobId) {
    const { data, error } = await db.from("import_jobs").insert({ kind: "csv", source: String(b.filename ?? "").slice(0, 200), mode, created_by: a.email }).select("id").single();
    if (error) return dbError(error);
    jobId = data.id;
  }
  if (items.length) {
    const { data, error } = await db.rpc("product_import_batch", { items, actor: a.email, opts: { mode, keep_missing_variants: true, source: "csv" } });
    if (error) return dbError(error);
    for (const r of data as any[]) {
      const res = results.find((x) => x.row === r.row && (x.status === "create" || x.status === "update"));
      if (!res) continue;
      res.status = r.action; res.product_id = r.id;
      if (r.action === "error") res.errors = { _: friendly(r.error, r.code) };
      if (r.action === "skipped") res.errors = { _: r.error };
    }
  }
  // dry_run olmayan yanıtta "create/update" kalmışsa (olmamalı) hata say
  for (const r of results) if (r.status === "create" || r.status === "update") { r.status = "error"; r.errors = { _: "Kaydedilemedi" }; }

  const { error: e1 } = await db.from("import_rows").upsert(results.map((r) => ({ job_id: jobId, row_no: r.row, sku: r.sku, status: r.status, errors: r.errors ?? null, product_id: r.product_id ?? null })));
  if (e1) return dbError(e1);
  const c = (s: string) => results.filter((r) => r.status === s).length;
  const { data: job } = await db.from("import_jobs").select("*").eq("id", jobId).single();
  const upd: any = {
    total: (job?.total ?? 0) + results.length, created: (job?.created ?? 0) + c("created"), updated: (job?.updated ?? 0) + c("updated"),
    stock_only: (job?.stock_only ?? 0) + c("stock"), unchanged: (job?.unchanged ?? 0) + c("unchanged"),
    skipped: (job?.skipped ?? 0) + c("skipped"), failed: (job?.failed ?? 0) + c("error"),
  };
  if (b.final) { upd.status = upd.failed ? "partial" : "ok"; upd.finished_at = new Date().toISOString(); }
  await db.from("import_jobs").update(upd).eq("id", jobId);
  return NextResponse.json({ job_id: jobId, results });
}

function friendly(msg = "", code = "") {
  if (code === "23505") return /barcode/.test(msg) ? "Barkod başka bir üründe kullanılıyor" : "SKU başka bir üründe kullanılıyor";
  if (code === "23514") return `Geçersiz değer (${msg})`;
  return msg;
}
