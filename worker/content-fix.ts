// İçerik düzeltme (K 19.11: açıklama ve özellikler ~%100 doğru; "yanlış istemiyorum, kesin olsun"; "dur demeyene kadar devam et,
// diğer yapay zekâları çalıştır, sen kontrol et"). İş diğer modellerde, karar kurallarda:
//  - Çelişki: kurallar (worker/core/contradictions.ts) + işçi modelin önerisi (yalnızca kural doğrularsa)
//  - Görseldeki ölçü: iki FARKLI görsel modeli (worker/core/image-dims.ts); anlaşırsa yazılır, anlaşamazsa ölçü cümlesi çıkar
//  - Özellik: başka satıcı ilanları (worker/core/attr-research.ts), kabul uzlaşma kuralıyla (worker/core/attr-consensus.ts)
// Sonuç panel onay tablosuna (product_descriptions, kind 'content-fix', status 'ready'); K onaylamadan pazaryerine bir şey gitmez.
//
//   node --experimental-strip-types worker/content-fix.ts preview [--limit 50]   tek tur önizleme (kapatma anahtarından bağımsız)
//   node --experimental-strip-types worker/content-fix.ts run                    sürekli: app_state content_fix {"enabled":true} iken, süre/kota/onay sınırına kadar
//   node --experimental-strip-types worker/content-fix.ts apply [--yes]          ONAYLANAN özellikleri uygula (varsayılan deneme; --yes yazar)
//   node --experimental-strip-types worker/content-fix.ts on | off | status
// Ortam: CONTENT_FIX_MINUTES (20), CONTENT_FIX_BATCH (20), CONTENT_FIX_MAX_PENDING (300), CONTENT_FIX_ATTRS (1), CONTENT_FIX_AI (1), DIMS_MODELS.
// Müşteri verisi okunmaz ve modele gitmez; K'nın kendi ürünleri (manual, Gezer/Voga/Racıng/Rasing/Hermes) ve gıda atlanır.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { env, readAll, chunk, OWN_BRANDS } from "./core/util.ts";
import { GeminiQuotaError, geminiEnabled } from "./core/gemini.ts";
import { llmJson, providers } from "./core/llm.ts";
import { detectAll, applyFindings, needsDimRead, toLines, type Finding, type AiContra, type DimReads } from "./core/contradictions.ts";
import { fetchImage, readDimsImages, visionCallers } from "./core/image-dims.ts";
import { attrConsensus, type WantAttr, type AttrProposal } from "./core/attr-consensus.ts";
import { researchAttributes } from "./core/attr-research.ts";
import { cleanHtml } from "./core/desc-check.ts";
import { getAttrs } from "../lib/mp-catalog.ts";
import { inScope } from "../lib/scope.ts";

const cmd = process.argv[2] ?? "";
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);
const md5 = (t: string) => createHash("md5").update(t).digest("hex");
const KEY = "content_fix", PROG = "content_fix_progress";

async function getState(key: string): Promise<any> {
  const { data } = await db.from("app_state").select("value").eq("key", key).maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : null; } catch { return null; }
}
async function setState(key: string, v: unknown) {
  const { error } = await db.from("app_state").upsert({ key, value: JSON.stringify(v), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`app_state ${key}: ${error.message}`);
}
const enabled = async () => (await getState(KEY))?.enabled === true;

const AI_SYSTEM = `Bir ürünün başlığını ve tedarikçi açıklamasını karşılaştıran denetçisin. Görevin: açıklamada ürünün MALZEMESİ hakkında başlıkla ÇELİŞEN cümleleri bulmak.
Örnek: başlık "316L çelik kolye", açıklama "925 ayar gümüşten üretilmiştir"; başlık "plastik saklama kabı", açıklama "malzemesi camdır".
Çelişki DEĞİL: "gümüş renk", "altın kaplama", "ahşap görünümlü", birden çok malzemeden yapılmış parçalar, eksik bilgi. Emin değilsen yazma.
quote: açıklamadaki cümleyi AYNEN kopyala. Yalnızca JSON: {"items":[{"kind":"malzeme","quote":"","title_term":"","desc_term":""}]}`;
const MATERIAL_HINT = /925|ayar|gümüş|gumus|altın|altin|deri|pamuk|polyester|plastik|ahşap|ahsap|tahta|bambu|cam|seramik|porselen|metal|çelik|celik|malzeme|materyal/i;

type P = { id: string; title: string; description: string; category: string | null; brand: string | null; source: string | null; attributes: Record<string, any> | null; source_hash: string; image_url: string | null };
let attrQuota = false; // bu çalışmada Gemini arama kotası doldu
type Res = { result: "degisiklik" | "yok" | "atlandi" | "hata"; findings: Finding[]; proposals: AttrProposal[]; summary: Record<string, any> };

async function wantedAttrs(p: P): Promise<WantAttr[]> {
  const { data } = await db.from("marketplace_listings").select("marketplace, category_id").eq("product_id", p.id).in("marketplace", ["trendyol", "hepsiburada"]).not("category_id", "is", null);
  const out: WantAttr[] = [];
  const seen = new Set<string>();
  for (const l of data ?? []) {
    const k = `${l.marketplace}|${l.category_id}`; if (seen.has(k)) continue; seen.add(k);
    const defs = await getAttrs(db, l.marketplace, String(l.category_id)).catch(() => []);
    const has = (n: string) => { const a = p.attributes ?? {}; return [n, `${n}@${l.marketplace}`].some((x) => a[x] != null && String(a[x]).trim() !== ""); };
    const list = defs.filter((d) => !d.variant && !d.custom && d.values.length > 0 && d.values.length <= 300 && !has(d.name) && !/garanti|menşe|mense|barkod|stok/i.test(d.name))
      .sort((a, b) => Number(b.required) - Number(a.required)).slice(0, 8);
    for (const d of list) out.push({ mp: l.marketplace, name: d.name, values: d.values, required: d.required });
  }
  return out;
}

async function processProduct(p: P): Promise<Res> {
  const summary: Record<string, any> = {};
  if (OWN_BRANDS.test(p.title) || OWN_BRANDS.test(String(p.brand ?? "")) || p.source === "manual") return { result: "atlandi", findings: [], proposals: [], summary: { neden: "K'nın kendi ürünü" } };
  const sc = inScope({ cat: p.category, title: p.title });
  if (!sc.ok) return { result: "atlandi", findings: [], proposals: [], summary: { neden: sc.reason } };
  // 1) Görseldeki ölçü: yalnızca açıklamada tek bir ölçü ifadesi varsa iki modelle okunur
  let dimReads: DimReads | null = null;
  if (needsDimRead(p.description) && p.image_url) {
    const callers = visionCallers();
    const { data: ims } = await db.from("product_images").select("url, position").eq("product_id", p.id).order("position").limit(4);
    const imgs = [];
    if (callers.length >= 2) for (const u of (ims ?? []).map((x: any) => x.url as string)) { const im = await fetchImage(u); if (im) imgs.push(im); }
    if (imgs.length) dimReads = await readDimsImages(imgs, callers, log);
    summary.gorselOlcu = dimReads ? { [dimReads.models[0]]: dimReads.a?.map((d) => d.raw) ?? "okunamadı", [dimReads.models[1]]: dimReads.b?.map((d) => d.raw) ?? "okunamadı" } : callers.length < 2 ? "iki görsel modeli ayarlı değil" : "görsel indirilemedi";
  }
  // 2) İşçi modelin malzeme çelişkisi önerileri (kural doğrulamadan geçmeyen atılır)
  let ai: AiContra[] = [];
  if (process.env.CONTENT_FIX_AI !== "0" && providers().length && MATERIAL_HINT.test(p.description) && MATERIAL_HINT.test(p.title)) {
    const lines = toLines(p.description).map((l) => l.sentences.join(" ")).join("\n").slice(0, 3500);
    const r = await llmJson<{ items?: AiContra[] }>(AI_SYSTEM, `BAŞLIK: ${p.title}\nKATEGORİ: ${p.category ?? ""}\nAÇIKLAMA:\n${lines}`, { log }).catch((e) => { log(`işçi model: ${String(e?.message ?? e).slice(0, 120)}`); return { data: null, by: "" }; });
    ai = (r.data?.items ?? []).slice(0, 6);
    summary.isciModel = { by: r.by, oneri: ai.length };
  }
  const findings = detectAll(p, { dimReads, ai });
  summary.yzOnayli = findings.filter((f) => f.by === "yapay_zeka+kural").length;
  // 3) Özellikler: başka satıcılar, uzlaşma
  let proposals: AttrProposal[] = [];
  if (attrQuota) summary.ozellik = { durum: "kota: bu turda özellik araştırması yapılmadı" };
  else if (process.env.CONTENT_FIX_ATTRS !== "0" && geminiEnabled()) try {
    const want = await wantedAttrs(p);
    if (want.length) {
      const { data: vs } = await db.from("product_variants").select("barcode").eq("product_id", p.id);
      const attrsText = Object.entries(p.attributes ?? {}).filter(([k, v]) => /model/i.test(k) && typeof v !== "object").map(([, v]) => String(v)).join(" ");
      const rr = await researchAttributes({ title: p.title, image_url: p.image_url, barcodes: (vs ?? []).map((v: any) => String(v.barcode ?? "")), attrsText }, want);
      const cons = attrConsensus(rr.cands, want, `${p.title}\n${p.description}`);
      proposals = cons.accepted;
      summary.ozellik = { durum: rr.status, cagri: rr.calls, adaylar: rr.detail.slice(0, 4), kabul: cons.accepted.length, cekimser: cons.abstained.slice(0, 8) };
    } else summary.ozellik = { durum: "eksik izinli-liste özelliği yok" };
  } catch (e: any) {
    // Gemini araması kotası: çelişki/ölçü işi sürer, özellik araştırması bu turda kapanır (sonra: content_fix_seen'de durum "kota" olanlar silinip yeniden denenir)
    if (!(e instanceof GeminiQuotaError || /kota|quota|429/i.test(String(e?.message)))) throw e;
    attrQuota = true; summary.ozellik = { durum: "kota: bu turda özellik araştırması yapılmadı" };
  }
  const acts = findings.filter((f) => f.action !== "note");
  if (!acts.length && !proposals.length) return { result: "yok", findings, proposals, summary };
  return { result: "degisiklik", findings, proposals, summary };
}

async function save(p: P, r: Res) {
  const now = new Date().toISOString();
  if (r.result === "degisiklik") {
    const fix = applyFindings(p.description, p.title, r.findings);
    let draft: string | null = null;
    if (fix.changed) {
      const c = cleanHtml(fix.html);
      if (c.error) throw new Error(`taslak HTML: ${c.error}`);
      draft = c.html;
    }
    const models = [r.summary.gorselOlcu ? Object.keys(r.summary.gorselOlcu).join("+") : "", r.summary.isciModel?.by ?? "", r.proposals.length ? "gemini-arama" : ""].filter(Boolean).join(" · ") || "kural";
    const { error } = await db.from("product_descriptions").upsert({
      product_id: p.id, source_hash: p.source_hash, status: "ready", kind: "content-fix", draft, original: p.description, reason: null,
      checks: { kind: "content-fix", changes: r.findings, summary: r.summary }, attr_proposals: r.proposals, research: { at: now, ...r.summary }, facts: [],
      model: models.slice(0, 200), pushed: {}, applied: {}, updated_at: now, decided_by: null, decided_at: null,
    }, { onConflict: "product_id" });
    if (error) throw new Error(`product_descriptions: ${error.message}`);
  }
  const { error } = await db.from("content_fix_seen").upsert({ product_id: p.id, source_hash: p.source_hash, checked_at: now, result: r.result,
    summary: { bulgu: r.findings.map((f) => `${f.kind}:${f.action}`), ozellik: r.proposals.length, ...r.summary } }, { onConflict: "product_id" });
  if (error) throw new Error(`content_fix_seen: ${error.message}`);
}

async function batchLoop(mode: "preview" | "run") {
  const limit = mode === "preview" ? Math.max(1, Math.min(200, Number(argOf("--limit") ?? 50))) : Infinity;
  const minutes = Number(process.env.CONTENT_FIX_MINUTES ?? 20), maxPending = Number(process.env.CONTENT_FIX_MAX_PENDING ?? 300);
  const batch = Math.max(1, Math.min(50, Number(process.env.CONTENT_FIX_BATCH ?? 20)));
  const t0 = Date.now();
  const prev = (await getState(PROG)) ?? {};
  const st: Record<string, any> = { mode, startedAt: new Date().toISOString(), processed: 0, degisiklik: 0, yok: 0, atlandi: 0, hata: 0, stop: "", total: prev.total ?? { processed: 0, degisiklik: 0 } };
  const flush = async () => { st.at = new Date().toISOString(); await setState(PROG, st).catch((e) => log(String(e.message))); };
  outer: while (st.processed < limit) {
    if (mode === "run" && !(await enabled())) { st.stop = "kapatma anahtarı kapalı (content_fix.enabled=false)"; break; }
    if (Date.now() - t0 > minutes * 60_000) { st.stop = `süre doldu (${minutes} dk)`; break; }
    if (mode === "run") {
      const { count } = await db.from("product_descriptions").select("product_id", { count: "exact", head: true }).eq("status", "ready").eq("kind", "content-fix");
      if ((count ?? 0) >= maxPending) { st.stop = `onay bekleyen ${count} (sınır ${maxPending}): K onaylayınca devam`; break; }
    }
    const { data, error } = await db.rpc("content_fix_candidates", { p_limit: Math.min(batch, limit - st.processed) });
    if (error) throw new Error(/content_fix_candidates/.test(error.message) ? "migration 095 uygulanmamış" : error.message);
    if (!data?.length) { st.stop = "aday kalmadı"; break; }
    for (const p of data as P[]) {
      if (mode === "run" && !(await enabled())) { st.stop = "kapatma anahtarı kapatıldı"; break outer; }
      try {
        const r = await processProduct(p);
        await save(p, r);
        st[r.result]++; st.processed++; st.total.processed++; if (r.result === "degisiklik") st.total.degisiklik++;
        log(`${r.result.padEnd(10)} ${p.title.slice(0, 60)}${r.findings.length ? ` | ${r.findings.map((f) => `${f.kind}:${f.action}`).join(",")}` : ""}${r.proposals.length ? ` | özellik ${r.proposals.length}` : ""}`);
      } catch (e: any) {
        if (e instanceof GeminiQuotaError || /kota|quota|429/i.test(String(e?.message))) { st.stop = `kota: ${String(e.message).slice(0, 150)}`; break outer; } // ürün işaretlenmez: sonra yeniden denenir
        st.hata++; st.processed++; st.lastError = String(e?.message ?? e).slice(0, 200); log(`hata ${p.title.slice(0, 50)}: ${st.lastError}`);
        await db.from("content_fix_seen").upsert({ product_id: p.id, source_hash: p.source_hash, checked_at: new Date().toISOString(), result: "hata", summary: { hata: st.lastError } }, { onConflict: "product_id" });
      }
      if (st.processed % 5 === 0) await flush();
      if (st.processed >= limit) break;
    }
  }
  if (!st.stop) st.stop = mode === "preview" ? `önizleme tamam (${st.processed})` : "bitti";
  await flush();
  console.log(JSON.stringify(st));
}

// Onaylanan özellikler: ürüne "<Özellik>@<pazaryeri>" (yalnızca boşsa), hatadaki ilanlar yeniden gönderim kuyruğuna, yayındaki Trendyol
// ilanına içerik güncellemesi (yalnızca ilanda içerik düzeyinde var olan özellik; seçenek özelliği değişmez). Aynı satır iki kez uygulanmaz.
async function apply(yes: boolean) {
  const rows = await readAll<any>((a, b) => db.from("product_descriptions").select("product_id, attr_proposals, applied, decided_by").eq("status", "approved").eq("kind", "content-fix").order("product_id").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const todo = rows.data.filter((r: any) => (r.attr_proposals ?? []).length && !r.applied?.attrs);
  const out: Record<string, any> = { onayli: todo.length, yazilacak: 0, yazilan: 0, kuyruk: {}, trendyolCanli: null, deneme: !yes };
  if (!todo.length) { console.log(JSON.stringify(out)); return; }
  const tyItems: { pid: string; set: Record<string, string> }[] = [];
  const reSend: Record<string, string[]> = {};
  for (const part of chunk(todo, 100)) {
    const { data: ps, error } = await db.from("products").select("id, title, brand, source, attributes").in("id", part.map((r: any) => r.product_id));
    if (error) throw new Error(error.message);
    const { data: ls } = await db.from("marketplace_listings").select("product_id, marketplace, status").in("product_id", part.map((r: any) => r.product_id));
    for (const r of part) {
      const p: any = (ps ?? []).find((x: any) => x.id === r.product_id);
      if (!p || p.source === "manual" || OWN_BRANDS.test(String(p.title ?? "")) || OWN_BRANDS.test(String(p.brand ?? ""))) continue;
      const add: Record<string, string> = {}, ty: Record<string, string> = {};
      for (const a of r.attr_proposals as AttrProposal[]) {
        const k = `${a.name}@${a.mp}`;
        if (p.attributes?.[k] != null && String(p.attributes[k]).trim() !== "") continue;
        add[k] = a.value; if (a.mp === "trendyol") ty[a.name] = a.value;
      }
      if (!Object.keys(add).length) continue;
      out.yazilacak++;
      if (Object.keys(ty).length) tyItems.push({ pid: p.id, set: ty });
      for (const mp of new Set((r.attr_proposals as AttrProposal[]).map((a) => a.mp)))
        if ((ls ?? []).some((l: any) => l.product_id === p.id && l.marketplace === mp && ["error", "rejected"].includes(l.status))) (reSend[mp] ??= []).push(p.id);
      if (!yes) continue;
      const { error: ue } = await db.from("products").update({ attributes: { ...(p.attributes ?? {}), ...add }, updated_at: new Date().toISOString() }).eq("id", p.id);
      if (ue) { log(`ürün ${p.id}: ${ue.message}`); continue; }
      await db.from("product_descriptions").update({ applied: { ...(r.applied ?? {}), attrs: { at: new Date().toISOString(), written: add } } }).eq("product_id", p.id);
      out.yazilan++;
    }
  }
  for (const [mp, ids] of Object.entries(reSend)) {
    out.kuyruk[mp] = ids.length;
    if (!yes) continue;
    for (const part of chunk(ids, 100)) await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: part }, idempotency_key: `content-fix:${mp}:${md5(part.join(","))}`, created_by: "içerik düzeltme (K onaylı özellik)" });
  }
  // Yayındaki Trendyol ilanları: content-bulk-update (worker/attr-fix.ts push ile aynı yol)
  if (tyItems.length && process.env.TRENDYOL_SELLER_ID) {
    const { getMarketplace } = await import("./marketplaces/index.ts");
    const mp = getMarketplace("trendyol");
    const listings = (await mp.loadListings()).filter((l: any) => l.status === "active" && l.contentId && l.attributes);
    const map = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, product_id").eq("marketplace", "trendyol").in("product_id", tyItems.map((t) => t.pid)).order("listing_key").range(a, b));
    const byContent = new Map<string, Record<string, string>>();
    for (const l of listings as any[]) {
      const pid = map.data?.find((m: any) => m.listing_key === l.id)?.product_id;
      const it = tyItems.find((t) => t.pid === pid);
      if (it && !byContent.has(l.contentId)) byContent.set(l.contentId, it.set);
    }
    if (!yes) process.env.SEND_DRY = "1";
    const r = await mp.updateAttributes!([...byContent].map(([contentId, set]) => ({ contentId, set })));
    out.trendyolCanli = { icerik: byContent.size, gonderilen: yes ? r.ok : 0, hazirlanan: r.sent.length, atlanan: r.skipped.length, parti: r.batchIds };
  }
  if (yes) await db.from("audit_log").insert({ actor: "content-fix apply", action: "update", entity: "products", entity_id: "content-fix", before: null, after: { yazilan: out.yazilan, kuyruk: out.kuyruk, trendyol: out.trendyolCanli } });
  console.log(JSON.stringify(out));
}

if (cmd === "preview") await batchLoop("preview");
else if (cmd === "run") await batchLoop("run");
else if (cmd === "apply") await apply(process.argv.includes("--yes"));
else if (cmd === "on" || cmd === "off") { await setState(KEY, { enabled: cmd === "on", at: new Date().toISOString(), by: "komut satırı" }); console.log(`content_fix ${cmd === "on" ? "AÇIK" : "KAPALI"}`); }
else if (cmd === "status") {
  const [s, p] = await Promise.all([getState(KEY), getState(PROG)]);
  const { count } = await db.from("product_descriptions").select("product_id", { count: "exact", head: true }).eq("status", "ready").eq("kind", "content-fix");
  console.log(JSON.stringify({ anahtar: s, ilerleme: p, onayBekleyen: count ?? 0 }, null, 1));
} else console.log("kullanım: content-fix.ts preview [--limit 50] | run | apply [--yes] | on | off | status");
