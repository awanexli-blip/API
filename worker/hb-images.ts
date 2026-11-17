// Hepsiburada görsel hatalarını düzeltir (K 17.11). Yayındaki ilanlarda mp_reasons "ImageN: Görseliniz erişim problemi nedeniyle
// indirilememiştir" (HB görseli çekemedi), "piksel boyutu ... küçük", "filigran", "hassas içerik".
// Yöntem: ürünün görselleri sunucuda indirilir, JPEG 1200x1200 beyaz zemine çevrilir (küçükler büyütülür), kendi depomuzdan
// (worker/core/img-host.ts) sunulur ve HB'ye ürün bilgisi güncelleme talebiyle (ticket-api integrator/import) gönderilir.
// Filigranlı / hassas içerikli görsel çıkarılır (yapay zekâyla silinmez); hiç görsel kalmayan ilan K'ya listelenir.
//
// Kullanım (sunucuda, trentakip kullanıcısıyla):
//   node --experimental-strip-types worker/hb-images.ts dry [--limit N] [--probe 20]   sayım + kaynak görsel ölçümü, yazma yok
//   node --experimental-strip-types worker/hb-images.ts test <listing_key>              tek ilan: hazırla + gönder, ham yanıt
//   node --experimental-strip-types worker/hb-images.ts apply --limit N                 N ilanı hazırla + gönder
//   node --experimental-strip-types worker/hb-images.ts check [--all]                   gönderilen taleplerin HB sonucu (--all: bitenler dahil)
// Aynı ilan 7 günde bir kereden fazla gönderilmez (marketplace_listings.img_fix_at). K'nın kendi ilanları (manual / Gezer, Voga,
// Racıng, Hermes, OZ) hiç ele alınmaz. Ürün/ilan silinmez.
import { createClient } from "@supabase/supabase-js";
import { env, sleep, chunk, readAll, isOwnListing, OWN_BRANDS } from "./core/util.ts";
import { hbClient } from "./marketplaces/hepsiburada.ts";
import { hostImage, publicOk, parseImageReasons, pickImages, type ImgIssues } from "./core/img-host.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const [cmd = "dry", ...rest] = process.argv.slice(2);
const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d; };
const LIMIT = opt("--limit", 0), PROBE = opt("--probe", 0), PAR = Math.max(1, Math.min(6, opt("--par", 4)));
const STATE_KEY = "hb_images_batches";
const AGAIN_DAYS = 7;

type Row = { listing_key: string; mp_sku: string | null; mp_reasons: string | null; img_fix_at: string | null; product_id: string; products: any };
type Item = { key: string; hbSku: string; pid: string; urls: string[]; issues: ImgIssues; dropped: string[] };

async function loadRows(onlyKey?: string): Promise<Row[]> {
  const sel = "listing_key, mp_sku, mp_reasons, img_fix_at, product_id, products(id, source, title, brand, product_images(url, position))";
  if (onlyKey) {
    const { data, error } = await db.from("marketplace_listings").select(sel).eq("marketplace", "hepsiburada").eq("listing_key", onlyKey);
    if (error) throw new Error(error.message);
    return (data ?? []) as any;
  }
  const { data, error } = await readAll<Row>((a, b) => db.from("marketplace_listings").select(sel).eq("marketplace", "hepsiburada").eq("status", "live")
    .ilike("mp_reasons", "%Image%").order("listing_key").range(a, b) as any);
  if (error) throw new Error(error.message);
  return data;
}

// Ele alınacak ilanlar: K'nın kendi ilanı değil, HB kodu var, görsel sorunu var
function toItems(rows: Row[], ignoreRecent = false) {
  const since = new Date(Date.now() - AGAIN_DAYS * 864e5).toISOString();
  const items: Item[] = [], noImage: string[] = [];
  const skip = { own: 0, noSku: 0, recent: 0, noIssue: 0 };
  for (const r of rows) {
    const p = r.products ?? {};
    if (p.source === "manual" || isOwnListing(r.listing_key, p.title) || OWN_BRANDS.test(String(p.title ?? "")) || OWN_BRANDS.test(String(p.brand ?? ""))) { skip.own++; continue; }
    if (!r.mp_sku) { skip.noSku++; continue; }
    if (!ignoreRecent && r.img_fix_at && r.img_fix_at > since) { skip.recent++; continue; }
    const issues = parseImageReasons(r.mp_reasons);
    const n = issues.access.length + issues.small.length + issues.watermark.length + issues.sensitive.length;
    if (!n) { skip.noIssue++; continue; }
    const urls = [...(p.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => String(i.url)).filter(Boolean);
    const { keep, dropped } = pickImages(urls, issues);
    if (!keep.length) { noImage.push(r.listing_key); continue; }
    items.push({ key: r.listing_key, hbSku: r.mp_sku, pid: r.product_id, urls: keep, issues, dropped });
  }
  return { items, noImage, skip };
}

// Görselleri hazırla (eşzamanlı PAR); ilk görsel hazırlanamazsa ilan bu turda atlanır, diğerlerinden olmayan çıkarılır
async function prepare(items: Item[]) {
  const ready: { it: Item; urls: string[] }[] = [];
  const failed: { key: string; why: string }[] = [];
  let i = 0, conv = 0, cached = 0, small = 0;
  const work = async () => {
    while (i < items.length) {
      const it = items[i++];
      const out: string[] = [];
      let firstErr = "";
      for (let k = 0; k < it.urls.length; k++) {
        try {
          const h = await hostImage(it.pid, it.urls[k]);
          if (h.cached) cached++; else { conv++; if (Math.max(h.srcW, h.srcH) && Math.max(h.srcW, h.srcH) < 1200) small++; }
          out.push(h.url);
        } catch (e: any) { if (k === 0) firstErr = String(e.message); }
      }
      if (firstErr || !out.length) { failed.push({ key: it.key, why: firstErr || "görsel yok" }); continue; }
      ready.push({ it, urls: out });
    }
  };
  await Promise.all(Array.from({ length: PAR }, work));
  // Herkese açık adres denetimi: her ilanın ilk görseli
  const bad = new Set<string>();
  for (const part of chunk(ready, 8)) await Promise.all(part.map(async (x) => { if (!(await publicOk(x.urls[0]))) bad.add(x.it.key); }));
  for (const k of bad) failed.push({ key: k, why: "herkese açık adres açılmadı" });
  return { ready: ready.filter((x) => !bad.has(x.it.key)), failed, conv, cached, small };
}

// HB ürün bilgisi güncelleme talebi: {merchantId, items:[{hbSku, image1..5}]} dosya olarak; takip numarası döner
async function sendTicket(c: ReturnType<typeof hbClient>, list: { it: Item; urls: string[] }[]) {
  const body = { merchantId: c.MERCHANT, items: list.map((x) => ({ hbSku: x.it.hbSku, ...Object.fromEntries(x.urls.slice(0, 5).map((u, i) => [`image${i + 1}`, u])) })) };
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(body)], { type: "application/json" }), "integrator-ticket-upload.json");
  return await c.hb(`${c.MPOP}/ticket-api/api/integrator/import?version=1`, { method: "POST", body: form });
}
const ticketId = (r: any) => String(r?.data?.trackingId ?? r?.trackingId ?? r?.data?.id ?? r?.id ?? r?.data ?? "");

async function loadState(): Promise<any[]> {
  const { data } = await db.from("app_state").select("value").eq("key", STATE_KEY).maybeSingle();
  try { const v = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value; return Array.isArray(v) ? v : []; } catch { return []; }
}
async function saveState(v: any[]) {
  const { error } = await db.from("app_state").upsert({ key: STATE_KEY, value: JSON.stringify(v.slice(-2000)), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error("app_state: " + error.message);
}

function summary(items: Item[]) {
  const s = { ilan: items.length, erisim: 0, kucuk: 0, filigran: 0, hassas: 0, cikarilanGorsel: 0 };
  for (const it of items) { if (it.issues.access.length) s.erisim++; if (it.issues.small.length) s.kucuk++; if (it.issues.watermark.length) s.filigran++; if (it.issues.sensitive.length) s.hassas++; s.cikarilanGorsel += it.dropped.length; }
  return s;
}

async function probe(items: Item[], n: number) {
  // Kaynak görsel ölçümü: HB'ye eskiden giden adres (wsrv.nl) ve tedarikçi kaynağı; süre, durum, boyut
  const { jpgUrl } = await import("./core/img-proxy.ts");
  const sample = items.slice().sort(() => Math.random() - 0.5).slice(0, n);
  const rows: string[] = [];
  for (const it of sample) {
    const idx = (it.issues.access[0] ?? 1) - 1, src = it.urls[idx] ?? it.urls[0];
    for (const [tag, u] of [["kaynak", src], ["gonderilen", jpgUrl(src)]] as const) {
      const t0 = Date.now();
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { "user-agent": "Mozilla/5.0" } });
        const b = Buffer.from(await r.arrayBuffer());
        let dim = "";
        try { const m = await (await import("sharp")).default(b).metadata(); dim = `${m.width}x${m.height} ${m.format}`; } catch { dim = "okunamadı"; }
        rows.push(`${it.key} ${tag} ${r.status} ${r.headers.get("content-type")} ${b.length}B ${dim} ${Date.now() - t0}ms ${u === src ? "" : "(dönüştürücü)"}`);
      } catch (e: any) { rows.push(`${it.key} ${tag} HATA ${String(e?.message ?? e).slice(0, 60)} ${Date.now() - t0}ms`); }
    }
  }
  return rows;
}

async function main() {
  if (cmd === "check") {
    const c = hbClient();
    const st = await loadState();
    const open = rest.includes("--all") ? st : st.filter((b) => !b.done);
    let okKeys: string[] = [], badN = 0;
    for (const b of open) {
      let r: any;
      try { r = await c.hb(`${c.MPOP}/ticket-api/api/integrator/status/${encodeURIComponent(b.id)}?page=0&size=100`); } catch (e: any) { console.log(`${b.id}: HATA ${String(e.message).slice(0, 300)}`); continue; }
      b.checks = (b.checks ?? 0) + 1;
      // Sayfalı (varsayılan 20 kalem; size=100 ile tek sayfa, talep başına 50 ilan). Yanıt (canlıda görüldü 17.11): {data:[{merchantId, items:[{hbSku, message, productStatus:"COMPLETED", updateResults:[{fieldName:"MEDIA", fieldResult:"APPROVED"}]}]}]}
      const groups: any[] = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [r?.data ?? r];
      const list: any[] = groups.flatMap((g) => Array.isArray(g?.items) ? g.items : []);
      const bySku = new Map<string, string>(b.items.map((x: any) => [String(x.hbSku), String(x.key)]));
      let pending = 0;
      const res: Record<string, number> = {};
      for (const x of list) {
        const ps = String(x.productStatus ?? "").toUpperCase();
        const fr = (Array.isArray(x.updateResults) ? x.updateResults : []).map((u: any) => String(u.fieldResult ?? "").toUpperCase());
        const tag = `${ps}/${fr.join("+") || "-"}`; res[tag] = (res[tag] ?? 0) + 1;
        if (ps !== "COMPLETED" && !/FAIL|ERROR|REJECT/.test(ps)) { pending++; continue; }
        if (ps === "COMPLETED" && fr.length && fr.every((f: string) => f === "APPROVED")) { const k = bySku.get(String(x.hbSku)); if (k) okKeys.push(k); }
        else { badN++; if (badN <= 10) console.log(`   ret ${bySku.get(String(x.hbSku)) ?? x.hbSku}: ${tag} ${String(x.message ?? "").slice(0, 200)}`); }
      }
      b.result = res;
      if (list.length && !pending) b.done = true;
      console.log(`${b.id}: kalem ${list.length}/${b.items.length}, bekleyen ${pending}, ${JSON.stringify(res)}`);
      await sleep(400);
    }
    // Başarılı ilanlarda görsel nedenleri temizlenir (diğer nedenler kalır); HB sonradan yine bildirirse ürün durumu sorgusu yazar
    okKeys = [...new Set(okKeys)];
    for (const part of chunk(okKeys, 200)) {
      const { data } = await db.from("marketplace_listings").select("listing_key, mp_reasons").eq("marketplace", "hepsiburada").in("listing_key", part);
      for (const r of data ?? []) {
        const rest = String(r.mp_reasons ?? "").split(/\s+·\s+/).filter((x) => !/^Image\s*\d+\s*:/i.test(x.trim())).join(" · ");
        await db.from("marketplace_listings").update({ mp_reasons: rest || null }).eq("marketplace", "hepsiburada").eq("listing_key", r.listing_key);
      }
    }
    await saveState(st);
    console.log(JSON.stringify({ acikTalep: open.length, basarili: okKeys.length, hatali: badN }));
    return;
  }

  const rows = await loadRows(cmd === "test" ? rest[0] : undefined);
  const { items, noImage, skip } = toItems(rows, cmd === "test");
  console.log(JSON.stringify({ satir: rows.length, atlanan: skip, gorselKalmayan: noImage.length, ...summary(items) }));
  if (noImage.length) console.log("Görseli kalmayan (K'ya):", noImage.slice(0, 50).join(", "), noImage.length > 50 ? `... +${noImage.length - 50}` : "");

  if (cmd === "dry") {
    if (PROBE) for (const l of await probe(items, PROBE)) console.log(l);
    return;
  }
  if (cmd !== "test" && cmd !== "apply") throw new Error(`bilinmeyen komut: ${cmd}`);
  if (cmd === "apply" && !LIMIT) throw new Error("apply için --limit N zorunlu (önce deneme)");

  const todo = cmd === "test" ? items.slice(0, 1) : items.slice(0, LIMIT);
  const c = hbClient();
  const st = await loadState();
  let sent = 0, failedPrep = 0, failedSend = 0;
  // Parça parça: 50 ilan hazırla -> gönder -> img_fix_at yaz (yarıda kalırsa kaldığı yerden sürer)
  for (const part of chunk(todo, 50)) {
    const p = await prepare(part);
    failedPrep += p.failed.length;
    for (const f of p.failed.slice(0, 5)) console.log(`hazırlanamadı ${f.key}: ${f.why}`);
    if (!p.ready.length) continue;
    try {
      const r = await sendTicket(c, p.ready);
      const id = ticketId(r);
      if (cmd === "test") console.log("HB yanıtı:", JSON.stringify(r).slice(0, 1500), "\nörnek görsel:", p.ready[0].urls.join(" "));
      if (!id) throw new Error("takip numarası yok: " + JSON.stringify(r).slice(0, 300));
      st.push({ id, at: new Date().toISOString(), items: p.ready.map((x) => ({ key: x.it.key, hbSku: x.it.hbSku, n: x.urls.length })) });
      await saveState(st);
      const now = new Date().toISOString();
      const { error } = await db.from("marketplace_listings").update({ img_fix_at: now }).eq("marketplace", "hepsiburada").in("listing_key", p.ready.map((x) => x.it.key));
      if (error) console.error("img_fix_at:", error.message);
      sent += p.ready.length;
      console.log(`gönderildi ${sent}/${todo.length} (talep ${id}; çevrilen ${p.conv}, önbellek ${p.cached}, büyütülen ${p.small})`);
    } catch (e: any) { failedSend += p.ready.length; console.error("gönderim hatası:", String(e.message).slice(0, 600)); if (cmd === "test") break; await sleep(5000); }
    await sleep(500);
  }
  console.log(JSON.stringify({ gonderilen: sent, hazirlanamayan: failedPrep, gonderilemeyen: failedSend }));
}

main().catch((e) => { console.error("HATA", String(e?.message ?? e)); process.exitCode = 1; });
