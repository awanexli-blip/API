// İmzalı e-Arşiv faturalarını Trendyol paketlerine yükler (K, 30.10). node --experimental-strip-types worker/invoice-upload.ts <dry|apply> [adet]
// dry: hiçbir şey yüklemez; her fatura için kontrolleri yapar, PDF'i basar (boyut/biçim), raporu app_state.invoice_upload_report'a yazar.
// apply: YALNIZCA son 24 saatteki deneme raporunda "uygun" çıkanları, kontrolleri yeniden yaparak yükler.
// Kontroller (hepsi tutmalı): fatura imzalı ve Trendyol siparişi; GİB belgesinde ETTN + belge no + sipariş no + alıcı adı + ödenecek tutar;
// tutar = sipariş tutarı + Trendyol indirimi; Trendyol'da sipariş no altında bu paket var, iptal değil, tutarı değişmemiş.
// Depo herkese açık: günlüğe/rapora alıcı adı ve PDF yazılmaz (yalnızca belge no, sipariş no, neden).
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, sleep } from "./core/util.ts";
import { createTrendyol } from "./marketplaces/trendyol.ts";
import { EarsivClient } from "../lib/earsiv.ts";
import { verifyInvoice } from "../lib/invoice-verify.ts";

const mode = process.argv[2] === "apply" ? "apply" : "dry";
const limit = Math.max(1, Math.min(200, Number(process.argv[3] ?? 200) || 200));
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const ty = createTrendyol();
const gib = new EarsivClient(env("GIB_PORTAL_USER"), env("GIB_PORTAL_PASS"), process.env.GIB_PORTAL_ENV === "TEST" ? "TEST" : "PROD");
const CHROME = process.env.CHROME_BIN || "google-chrome";
const BAD_STATUS = /cancel|unsupplied|unpacked/i;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Out = { belge_no: string | null; order_no: string | null; ok: boolean; reason?: string; result?: string };
const report: Out[] = [];

const { data: rows, error } = await db.from("order_invoices")
  .select("order_id, ettn, belge_no, amount, status, orders(marketplace, package_id, order_no, total, status, customer_name, order_lines(ty_discount))")
  .eq("status", "signed").order("belge_no");
if (error) throw new Error(error.message);
let list = (rows ?? []).filter((r: any) => r.orders?.marketplace === "trendyol");

if (mode === "apply") {
  const { data: st } = await db.from("app_state").select("value").eq("key", "invoice_upload_report").maybeSingle();
  const prev = st?.value ? JSON.parse(st.value) : null;
  if (!prev || prev.mode !== "dry" || Date.now() - Date.parse(prev.at) > 24 * 3600000) throw new Error("Önce deneme çalıştırılmalı (son deneme yok ya da 24 saatten eski)");
  const allow = new Set((prev.rows ?? []).filter((x: Out) => x.ok).map((x: Out) => x.belge_no));
  list = list.filter((r: any) => allow.has(r.belge_no));
}
list = list.slice(0, limit);

const dir = mkdtempSync(join(tmpdir(), "fatura-"));
function toPdf(html: string): Uint8Array {
  const h = join(dir, "f.html"), p = join(dir, "f.pdf");
  writeFileSync(h, /<meta[^>]+charset/i.test(html) ? html : `<meta charset="utf-8">${html}`);
  rmSync(p, { force: true });
  execFileSync(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${p}`, `file://${h}`], { stdio: "ignore", timeout: 60000 });
  const b = readFileSync(p);
  if (b.length < 1000 || b.length > 10 * 1024 * 1024 || b.subarray(0, 4).toString() !== "%PDF") throw new Error(`PDF geçersiz (${b.length} bayt)`);
  return new Uint8Array(b);
}

let uploaded = 0, already = 0, failed = 0;
try {
  if (list.length) await gib.login();
  for (const r of list as any[]) {
    const o = r.orders;
    const out: Out = { belge_no: r.belge_no, order_no: o.order_no, ok: false };
    report.push(out);
    try {
      // 1) sistem içi tutarlılık
      if (!r.ettn || !r.belge_no) throw new Error("ETTN / belge no yok");
      if (!o.customer_name) throw new Error("alıcı adı sistemde yok (silinmiş olabilir): elle yükle");
      if (BAD_STATUS.test(o.status ?? "")) throw new Error(`sipariş durumu ${o.status}`);
      const tyDisc = (o.order_lines ?? []).reduce((a: number, l: any) => a + (Number(l.ty_discount) || 0), 0);
      const expected = r2(Number(o.total) + tyDisc);
      if (Math.abs(Number(r.amount) - expected) > 0.01) throw new Error(`fatura tutarı ${Number(r.amount).toFixed(2)} ≠ sipariş ${expected.toFixed(2)}`);
      // 2) GİB belgesi
      const html = await gib.invoiceHtml(r.ettn, true);
      const v = verifyInvoice({ html, ettn: r.ettn, belgeNo: r.belge_no, orderNo: o.order_no ?? "", amount: Number(r.amount), customerName: o.customer_name });
      if (!v.ok) throw new Error(`GİB belgesi: ${v.problems.join(", ")}`);
      // 3) Trendyol paketi (canlı)
      const pk = await ty.orderPackages!(String(o.order_no));
      await sleep(300);
      const p = pk.find((x) => x.packageId === String(o.package_id));
      if (!p) throw new Error(`Trendyol'da bu sipariş no altında paket ${o.package_id} yok`);
      if (BAD_STATUS.test(p.status)) throw new Error(`Trendyol paket durumu ${p.status}`);
      if (p.total == null || Math.abs(p.total - Number(o.total)) > 0.01) throw new Error(`Trendyol paket tutarı ${p.total ?? "?"} ≠ sistem ${Number(o.total).toFixed(2)}`);
      // 4) PDF
      const pdf = toPdf(html);
      if (mode === "dry") { out.ok = true; out.result = `uygun (PDF ${Math.round(pdf.length / 1024)} KB${pk.length > 1 ? `, siparişte ${pk.length} paket` : ""})`; continue; }
      const u = await ty.uploadInvoice!(String(o.package_id), pdf, r.belge_no);
      await sleep(300);
      const now = new Date().toISOString();
      if (!u.ok && !u.already) throw new Error(`Trendyol ${u.status}: ${u.message ?? ""}`);
      out.ok = true; out.result = u.ok ? "yüklendi" : "Trendyol'da bu pakete daha önce fatura yüklenmiş (409)";
      if (u.ok) uploaded++; else already++;
      await db.from("order_invoices").update({ status: "uploaded", uploaded_at: now, error: u.ok ? null : "Trendyol: pakete daha önce fatura yüklenmiş (409); Trendyol panelinden kontrol et", updated_at: now })
        .eq("order_id", r.order_id).eq("status", "signed");
    } catch (e: any) {
      failed++; out.reason = String(e?.message ?? e).slice(0, 200);
      if (mode === "apply") await db.from("order_invoices").update({ error: `Trendyol yükleme: ${out.reason}`, updated_at: new Date().toISOString() }).eq("order_id", r.order_id);
    }
  }
} finally {
  await gib.logout().catch(() => null);
  rmSync(dir, { recursive: true, force: true });
}

const summary = { mode, at: new Date().toISOString(), total: report.length, ok: report.filter((x) => x.ok).length, uploaded, already, failed,
  run: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null, rows: report };
const w = await db.from("app_state").upsert({ key: "invoice_upload_report", value: JSON.stringify(summary), updated_at: summary.at });
if (w.error) console.error(`Rapor yazılamadı: ${w.error.message}`);
console.log(JSON.stringify({ ...summary, rows: undefined }));
for (const x of report) if (!x.ok) console.log(`${x.belge_no} / ${x.order_no}: ${x.reason}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Fatura yükleme (${mode === "dry" ? "deneme" : "gerçek"})\n\nToplam ${summary.total} · uygun ${summary.ok} · yüklendi ${uploaded} · zaten vardı ${already} · atlandı/hata ${failed}\n\n${report.filter((x) => !x.ok).map((x) => `- ${x.belge_no} / ${x.order_no}: ${x.reason}`).join("\n")}\n`);
}
