// Stok koruyucu (K 26.11): "en önemli olay stokların zamanında sıfırlanması, bu hatayı bir daha istemiyorum".
// 26.11 balaklava (Bezos, 3916684710449): tedarikçi stoğu 18:06'da bitti, HB'ye 0 ancak 19:07'de gitti (HB turu 2-3 saat), arada sipariş geldi.
// Bu iş ana senkrondan bağımsız, ağır iş kilidi OLMADAN birkaç dakikada bir çalışır: son çalışmadan beri değişen varyantlardan
// stoğu en az stokun altına düşen ya da pasife düşen ürünlerin YAYINDAKİ, stoklu görünen ilanlarına 0 gönderir.
// Stok artırma yalnızca koruyucunun kendi sıfırladığı ilanlarda, stok geri gelince (K 27.11; migration 103). Fiyat her zaman ana senkronda.
//
//   node --experimental-strip-types worker/stock-guard.ts            # kuru çalışma (gönderim yok, aday sayısı)
//   node --experimental-strip-types worker/stock-guard.ts --apply    # pazaryerine 0 gönderir
//   ... --full                                                        # tam tarama (pencere yok)
// Ortam: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (sunucu veritabanı), STOCK_GUARD_MARKETPLACES (varsayılan hepsiburada),
// STOCK_GUARD_MAX (tek çalışmada en çok, varsayılan 10000; fazlası sonraki çalışmada). Kapatma: app_state stock_guard_off = true.
import { createClient } from "@supabase/supabase-js";
import { env, readAll } from "./core/util.ts";
import { getMarketplace } from "./marketplaces/index.ts";
import { tgSend } from "./core/telegram.ts";
import { readFileSync, writeFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const forceFull = process.argv.includes("--full");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const mps = (process.env.STOCK_GUARD_MARKETPLACES ?? "hepsiburada").split(",").map((s) => s.trim()).filter(Boolean);
const MAX = Number(process.env.STOCK_GUARD_MAX ?? 10000);
const OVERLAP_MS = 10 * 60000; // pencere örtüşmesi: yarıda kalan içe aktarma / saat farkı kaçmasın
const FULL_EVERY_MS = 60 * 60000; // saatte bir tam tarama (pencerede kaçan olursa)


// Uyarı en çok 30 dakikada bir (iş 3 dakikada bir çalışır; Telegram dolmasın). Zaman damgası dosyada: veritabanına ulaşılamazken de çalışır.
const WARN_FILE = "/run/lock/trentakip-stockguard.warn";
async function warnOnce(msg: string) {
  try { if (Date.now() - Number(readFileSync(WARN_FILE, "utf8")) < 30 * 60000) return; } catch { /* ilk uyarı */ }
  try { writeFileSync(WARN_FILE, String(Date.now())); } catch { /* yazılamazsa yine gönder */ }
  await tgSend(msg);
}

async function run() {
  const off = await db.from("app_state").select("value").eq("key", "stock_guard_off").maybeSingle();
  if (off.error) throw new Error(`app_state okunamadı: ${off.error.message}`);
  if (off.data?.value === true || off.data?.value === "true") { console.log(JSON.stringify({ off: true })); return; }

  let failed = false;
  const out: Record<string, unknown> = { apply };
  for (const id of mps) {
    const startedAt = new Date();
    // Trendyol ayarları ortak "settings" tablosunda (sync.ts loadSettings ile aynı kural); diğerleri marketplace_settings
    const set = id === "trendyol"
      ? await db.from("settings").select("enabled:auto_sync, min_stock").eq("id", 1).maybeSingle()
      : await db.from("marketplace_settings").select("enabled, min_stock").eq("marketplace", id).maybeSingle();
    if (set.error) throw new Error(`${id} ayarları okunamadı: ${set.error.message}`);
    // Sıfırlama güvenli yöndür: Trendyol'da otomatik senkron kapalı olsa da yayındaki ilan tükenince sıfırlanır
    if (id !== "trendyol" && !set.data?.enabled) { out[id] = { skipped: "pazaryeri kapalı" }; continue; }
    const minStock = Math.max(1, Number(set.data?.min_stock ?? 1) || 1);

    const stKey = `stock_guard:${id}`;
    const st = await db.from("app_state").select("value").eq("key", stKey).maybeSingle();
    if (st.error) throw new Error(`durum okunamadı: ${st.error.message}`);
    // app_state.value text kolonu: nesne JSON metni olarak döner (26.11: okunmayınca her tur tam tarama yapıyordu)
    let prev: any = st.data?.value ?? {};
    if (typeof prev === "string") { try { prev = JSON.parse(prev); } catch { prev = {}; } }
    const lastOk = Date.parse(prev.cursor ?? "");
    const lastFull = Date.parse(prev.lastFull ?? "");
    const full = forceFull || !Number.isFinite(lastOk) || !Number.isFinite(lastFull) || Date.now() - lastFull > FULL_EVERY_MS;
    const since = full ? null : new Date(lastOk - OVERLAP_MS).toISOString();

    const t0 = Date.now();
    // readAll: PostgREST tek istekte en çok 1000 satır verir (hatasız keser; 26.11 ilk tam tarama 8.079 adayın 1000'ini görüyordu)
    const c = await readAll<{ listing_key: string; avail: number; prod_status: string; known_qty: number }>((a, b) => db.rpc("stock_guard_candidates", { p_mp: id, p_since: since, p_min_stock: minStock }).order("listing_key").range(a, b));
    if (c.error) throw new Error(`${id} adaylar okunamadı: ${c.error.message}`);
    const rows = c.data ?? [];
    const keys = [...new Set(rows.map((r) => r.listing_key))];
    const todo = keys.slice(0, MAX);
    const res: Record<string, unknown> = { full, since, minStock, candidates: keys.length, queryMs: Date.now() - t0, sample: todo.slice(0, 5) };

    if (apply && todo.length) {
      const mp = getMarketplace(id);
      const r = await mp.zeroStock(todo);
      res.sent = r.ok; res.failedBatches = r.failed; res.batchIds = r.batchIds.slice(0, 5);
      if (r.errors?.length) res.errors = r.errors;
      // Yalnızca başarılı gönderim işaretlenir; hata varsa hepsi sonraki çalışmada yeniden denenir (aynı 0 tekrar gitse zararsız)
      if (!r.failed) {
        for (let i = 0; i < todo.length; i += 1000) {
          const m = await db.rpc("stock_guard_mark", { p_mp: id, p_keys: todo.slice(i, i + 1000) });
          if (m.error) { res.markError = m.error.message.slice(0, 200); break; }
        }
      } else failed = true;
    }
    // İmleç yalnızca başarılı çalışmada ilerler (hata/kuru çalışmada pencere kaymaz)
    if (apply && !failed && keys.length <= MAX) {
      const value = { cursor: startedAt.toISOString(), lastFull: full ? startedAt.toISOString() : prev.lastFull, last: { at: startedAt.toISOString(), ...res } };
      const w = await db.from("app_state").upsert({ key: stKey, value }, { onConflict: "key" });
      if (w.error) res.stateError = w.error.message.slice(0, 200);
    }
    if (keys.length > MAX) res.backlog = keys.length - MAX;

    // Geri açma (K 27.11 onay, migration 103): yalnızca KORUYUCUNUN sıfırladığı ilanlar, tedarikçide stok geri gelince (XML geçici
    // bozulup düzelince). Yalnızca stok gider, fiyat ana senkronda. Kopya kaybedenleri (aynı tedarikçi kodu, en ucuz dışındakiler) açılmaz.
    const rs = await readAll<{ listing_key: string; qty: number }>((a, b) => db.rpc("stock_guard_restock_candidates", { p_mp: id, p_min_stock: minStock }).order("listing_key").range(a, b));
    if (rs.error) res.restockError = rs.error.message.slice(0, 200);
    else if (rs.data.length) {
      const dl = await readAll<{ listing_key: string }>((a, b) => db.rpc("dup_listing_losers", { p_mp: id, p_min_stock: minStock }).order("listing_key").range(a, b));
      if (dl.error) res.restockError = `kopya ilanlar okunamadı, geri açma ertelendi: ${dl.error.message.slice(0, 150)}`;
      else {
        const losers = new Set(dl.data.map((x) => x.listing_key));
        const up = rs.data.filter((x) => x.qty > 0 && !losers.has(x.listing_key)).slice(0, MAX);
        res.restockCandidates = rs.data.length; res.restock = up.length; res.restockSample = up.slice(0, 3).map((x) => x.listing_key);
        if (apply && up.length) {
          const mp = getMarketplace(id);
          const r = await mp.pushInventory(up.map((x) => ({ id: x.listing_key, price: null, quantity: x.qty })));
          res.restocked = r.ok; res.restockFailedBatches = r.failed;
          if (r.errors?.length) res.restockErrors = r.errors;
          if (!r.failed) {
            for (let i = 0; i < up.length; i += 1000) {
              const part = up.slice(i, i + 1000);
              const m = await db.rpc("stock_guard_restocked", { p_mp: id, p_keys: part.map((x) => x.listing_key), p_qtys: part.map((x) => x.qty) });
              if (m.error) { res.restockMarkError = m.error.message.slice(0, 200); break; }
            }
          }
        }
      }
    }
    out[id] = res;
    if (apply && failed) await warnOnce(`🚨 <b>Stok koruyucu</b> (${id}): ${todo.length} ilana stok 0 gönderilemedi, bir sonraki çalışmada yeniden denenecek.\n${String((res.errors as string[] | undefined)?.[0] ?? "").slice(0, 300)}`);
  }
  console.log(JSON.stringify(out));
  if (failed) process.exitCode = 1;
}

// Koruyucu çalışamıyorsa (veritabanı/pazaryeri erişimi) sessiz kalmaz: tükenen ürünler o sürede sıfırlanmıyor demektir
await run().catch(async (e: any) => {
  console.error(e);
  if (apply) await warnOnce(`🚨 <b>Stok koruyucu çalışamadı</b>: ${String(e?.message ?? e).slice(0, 300)}\nTükenen ürünlerin stoğu şu an otomatik sıfırlanmıyor; 3 dakika sonra yeniden denenecek.`);
  process.exitCode = 1;
});
