// Mükerrer fatura denetimi (K, 31.10: "önceden kestiğim faturaları sistem tekrar oluşturdu, zarar yazar mı"). SALT OKUNUR: GİB'de hiçbir şey
// oluşturmaz/silmez/imzalamaz, Trendyol'a bir şey göndermez. Son 45 günün portal belgeleri GÜN GÜN okunur (60 günlük aralık boş dönüyordu);
// sistemin kaydında olmayan (elle kesilen) her belge, alıcı adı + tarihle siparişlere eşlenir; o siparişin sistem faturası da varsa MÜKERRER.
// Rapor app_state.invoice_audit_report (veritabanı). Depo herkese açık: günlüğe yalnızca sayılar yazılır (ad, belge/sipariş no yok).
// node --experimental-strip-types worker/invoice-audit.ts
import { createClient } from "@supabase/supabase-js";
import { appendFileSync } from "node:fs";
import { env, readAll } from "./core/util.ts";
import { EarsivClient, isDeleted, isSigned, type EarsivDoc } from "../lib/earsiv.ts";
import { trDateTime } from "../lib/invoice-build.ts";
import { docName, docTime } from "../lib/invoice-match.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const gib = new EarsivClient(env("GIB_PORTAL_USER"), env("GIB_PORTAL_PASS"), process.env.GIB_PORTAL_ENV === "TEST" ? "TEST" : "PROD");
const fold = (s: unknown) => String(s ?? "").normalize("NFC").replace(/[İIıi]/g, "I").replace(/[Şş]/g, "S").replace(/[Ğğ]/g, "G").replace(/[Üü]/g, "U").replace(/[Öö]/g, "O").replace(/[Çç]/g, "C").toUpperCase().replace(/[^A-Z]/g, "");

const inv = await readAll<any>((a, b) => db.from("order_invoices").select("order_id, ettn, belge_no, status, amount").order("order_id").range(a, b));
if (inv.error) throw new Error(inv.error.message);
const ours = new Map<string, any>(inv.data.filter((r) => r.ettn).map((r) => [r.ettn, r]));
const invByOrder = new Map<string, any>(inv.data.map((r) => [r.order_id, r]));
const ord = await readAll<any>((a, b) => db.from("orders").select("id, order_no, marketplace, status, total, ordered_at, customer_name").gte("ordered_at", new Date(Date.now() - 75 * 86400000).toISOString()).not("customer_name", "is", null).order("id").range(a, b));
if (ord.error) throw new Error(ord.error.message);

const docs = new Map<string, EarsivDoc>();
let fieldKeys: string[] = [];
try {
  await gib.login();
  for (let i = 0; i < 45; i++) {
    const day = trDateTime(new Date(Date.now() - i * 86400000)).date;
    for (const d of await gib.list(day, day)) { if (d.ettn) docs.set(d.ettn, d); if (!fieldKeys.length) fieldKeys = Object.keys(d).sort(); }
  }
} finally { await gib.logout().catch(() => null); }

type Row = { belge_no: string | null; onay: string; tarih: string | null; kind: string; order_no?: string | null; marketplace?: string; our_belge_no?: string | null; our_status?: string; our_amount?: number | null; candidates?: number };
const rows: Row[] = [];
const all = [...docs.values()];
const foreign = all.filter((d) => !ours.has(d.ettn) && !isDeleted(d));
for (const d of foreign) {
  const name = fold(docName(d)), t = docTime(d);
  const cands = name.length >= 4 ? ord.data.filter((o) => fold(o.customer_name) === name && (t == null || !o.ordered_at || Date.parse(o.ordered_at) <= t + 86400000)) : [];
  const base: Row = { belge_no: d.belgeNumarasi ?? null, onay: String(d.onayDurumu ?? ""), tarih: (d.belgeTarihi as string) ?? null, kind: "" };
  if (!cands.length) { rows.push({ ...base, kind: "siparişle eşleşmedi" }); continue; }
  for (const o of cands) {
    const our = invByOrder.get(o.id);
    const ourLive = our && ["signed", "uploaded", "draft"].includes(our.status);
    const kind = !ourLive ? "elle kesilmiş, sistemde faturası yok (bağlanabilir)"
      : isSigned(d) && our.status !== "draft" ? "MÜKERRER: iki imzalı fatura"
      : isSigned(d) ? "elle imzalı + sistem taslağı (taslak silinmeli)"
      : "elle taslak (imzasız) + sistem faturası: elle taslak silinmeli";
    rows.push({ ...base, kind, order_no: o.order_no, marketplace: o.marketplace, our_belge_no: our?.belge_no ?? null, our_status: our?.status, our_amount: our?.amount != null ? Number(our.amount) : null, candidates: cands.length });
  }
}
const count = (k: string) => rows.filter((r) => r.kind.startsWith(k)).length;
const summary = { at: new Date().toISOString(), portalDocs: all.length, ourDocs: all.filter((d) => ours.has(d.ettn)).length, foreign: foreign.length,
  foreignSigned: foreign.filter(isSigned).length, duplicateSigned: count("MÜKERRER"), fieldKeys, rows };
const w = await db.from("app_state").upsert({ key: "invoice_audit_report", value: JSON.stringify(summary), updated_at: summary.at });
if (w.error) console.error(`Rapor yazılamadı: ${w.error.message}`);
const line = `Portal belgeleri ${summary.portalDocs} · sistemin ${summary.ourDocs} · elle ${summary.foreign} (imzalı ${summary.foreignSigned}) · iki imzalı fatura olan sipariş: ${summary.duplicateSigned}`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Mükerrer fatura denetimi (salt okunur)\n\n${line}\n\nAyrıntı veritabanında (app_state.invoice_audit_report).\n`);
