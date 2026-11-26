// Stok koruyucu (K 26.11): "en önemli olay stokların zamanında sıfırlanması, bu hatayı bir daha istemiyorum".
// 26.11 balaklava (Bezos, 3916684710449): tedarikçi stoğu 18:06'da bitti, HB'ye 0 ancak 19:07'de gitti (HB turu 2-3 saat), arada sipariş geldi.
// Bu iş ana senkrondan bağımsız, ağır iş kilidi OLMADAN birkaç dakikada bir çalışır: son çalışmadan beri değişen varyantlardan
// stoğu en az stokun altına düşen ya da pasife düşen ürünlerin YAYINDAKİ, stoklu görünen ilanlarına 0 gönderir.
// Yalnızca sıfırlama: stok artırma ve fiyat ana senkronda kalır (yanlışlıkla satış açmaz).
//
//   node --experimental-strip-types worker/stock-guard.ts            # kuru çalışma (gönderim yok, aday sayısı)
//   node --experimental-strip-types worker/stock-guard.ts --apply    # pazaryerine 0 gönderir
//   ... --full                                                        # tam tarama (pencere yok)
// Ortam: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (sunucu veritabanı), STOCK_GUARD_MARKETPLACES (varsayılan hepsiburada),
// STOCK_GUARD_MAX (tek çalışmada en çok, varsayılan 5000; fazlası sonraki çalışmada). Kapatma: app_state stock_guard_off = true.
import { createClient } from "@supabase/supabase-js";
import { env } from "./core/util.ts";
import { getMarketplace } from "./marketplaces/index.ts";
import { tgSend } from "./core/telegram.ts";

const apply = process.argv.includes("--apply");
const forceFull = process.argv.includes("--full");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const mps = (process.env.STOCK_GUARD_MARKETPLACES ?? "hepsiburada").split(",").map((s) => s.trim()).filter(Boolean);
const MAX = Number(process.env.STOCK_GUARD_MAX ?? 5000);
const OVERLAP_MS = 10 * 60000; // pencere örtüşmesi: yarıda kalan içe aktarma / saat farkı kaçmasın
const FULL_EVERY_MS = 60 * 60000; // saatte bir tam tarama (pencerede kaçan olursa)

const off = await db.from("app_state").select("value").eq("key", "stock_guard_off").maybeSingle();
if (off.error) throw new Error(`app_state okunamadı: ${off.error.message}`);
if (off.data?.value === true || off.data?.value === "true") { console.log(JSON.stringify({ off: true })); process.exit(0); }

let failed = false;
const out: Record<string, unknown> = { apply };
for (const id of mps) {
  const startedAt = new Date();
  const set = await db.from("marketplace_settings").select("enabled, min_stock").eq("marketplace", id).maybeSingle();
  if (set.error) throw new Error(`${id} ayarları okunamadı: ${set.error.message}`);
  if (!set.data?.enabled) { out[id] = { skipped: "pazaryeri kapalı" }; continue; }
  const minStock = Math.max(1, Number(set.data.min_stock ?? 1) || 1);

  const stKey = `stock_guard:${id}`;
  const st = await db.from("app_state").select("value").eq("key", stKey).maybeSingle();
  if (st.error) throw new Error(`durum okunamadı: ${st.error.message}`);
  const prev: any = st.data?.value ?? {};
  const lastOk = Date.parse(prev.cursor ?? "");
  const lastFull = Date.parse(prev.lastFull ?? "");
  const full = forceFull || !Number.isFinite(lastOk) || !Number.isFinite(lastFull) || Date.now() - lastFull > FULL_EVERY_MS;
  const since = full ? null : new Date(lastOk - OVERLAP_MS).toISOString();

  const t0 = Date.now();
  const c = await db.rpc("stock_guard_candidates", { p_mp: id, p_since: since, p_min_stock: minStock });
  if (c.error) throw new Error(`${id} adaylar okunamadı: ${c.error.message}`);
  const rows = (c.data ?? []) as { listing_key: string; avail: number; prod_status: string; known_qty: number }[];
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
  out[id] = res;
  // Hata uyarısı en çok 30 dakikada bir (çalışma birkaç dakikada bir; Telegram dolmasın)
  const lastWarn = Date.parse(prev.warnedAt ?? "");
  if (apply && failed && !(Date.now() - lastWarn < 30 * 60000)) {
    await db.from("app_state").upsert({ key: stKey, value: { ...prev, warnedAt: new Date().toISOString() } }, { onConflict: "key" });
    await tgSend(`🚨 <b>Stok koruyucu</b> (${id}): ${todo.length} ilana stok 0 gönderilemedi, bir sonraki çalışmada yeniden denenecek.\n${String((res.errors as string[] | undefined)?.[0] ?? "").slice(0, 300)}`);
  }
}
console.log(JSON.stringify(out));
if (failed) process.exit(1);
