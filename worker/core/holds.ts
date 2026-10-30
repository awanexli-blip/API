// Elle değişiklik koruması (migration 074; K, 30.10): pazaryerinde elle düzenlenen ya da elle eklenen ilan, K karar verene kadar
// senkronla ezilmez. Karar Telegram düğmeleriyle (hl:a|p|s:<id>) ya da panelden:
//   keep_all   = fiyat ve stoğa dokunma          keep_price = fiyat kalsın, stok tedarikçiden
//   sync       = sistemle eşitle (bir kez gönderilir, kayıt silinir)
// Algılama (gönderimden hemen önce, sync.ts):
//   düzenlendi: daha önce gönderdiğimiz ilanda pazaryeri fiyatı gönderdiğimizden VE bir önceki görüntüden farklı (gecikme değil),
//               ya da stok gönderdiğimizden fazla (satış stoğu yalnızca düşürür), ya da stok 0 iken son günde satış yok.
//   elle eklendi: özellik açıldıktan sonra görülen, hiç gönderilmemiş, fiyatı sistemin fiyatından belirgin farklı ilan.
// Tablo / kolonlar yoksa (migration 074 öncesi) koruma kapalıdır, senkron eskisi gibi çalışır.
import type { InventoryItem, Listing } from "../marketplaces/types.ts";
import { readAll, chunk } from "./util.ts";
import { esc, telegramEnabled, tgSend } from "./telegram.ts";
import { notifyOnce } from "./notify.ts";

export type Sent = { sent_price: number | null; sent_qty: number | null; price: number | null; stock: number | null; pushed_at: string | null; first_seen_at: string | null };
export type HoldStatus = "pending" | "keep_all" | "keep_price" | "sync";
export type Hold = { id: string; listing_key: string; status: HoldStatus; kind: "edited" | "manual_new"; title?: string | null };
export type Decision = { action: "push" | "skip" | "qty_only"; detect?: "edited" | "manual_new"; resolve?: boolean };

const num = (x: unknown) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

// Saf karar (test edilir). fresh = ilan bu çalışmada ilk kez görülüyor (tabloda yok) ve koruma daha önce başlatılmış.
export function decide(it: InventoryItem, ls: Listing | undefined, s: Sent | undefined, h: Hold | undefined, opts: { fresh: boolean; soldRecently: number }): Decision {
  if (h) {
    if (h.status === "pending" || h.status === "keep_all") return { action: "skip" };
    if (h.status === "keep_price") return { action: "qty_only" };
    return { action: "push", resolve: true };
  }
  if (!ls) return { action: "push" };
  const lp = num(ls.price), lq = num(ls.quantity);
  if (s?.pushed_at) {
    const sp = num(s.sent_price), sq = num(s.sent_qty), prevP = num(s.price), prevQ = num(s.stock);
    const priceEdited = lp != null && sp != null && Math.abs(lp - sp) > 0.01 && (prevP == null || Math.abs(lp - prevP) > 0.01);
    const qtyUp = lq != null && sq != null && lq > sq && lq !== prevQ;
    const qtyZero = lq === 0 && sq != null && sq >= 3 && prevQ !== 0 && opts.soldRecently === 0;
    return priceEdited || qtyUp || qtyZero ? { action: "skip", detect: "edited" } : { action: "push" };
  }
  // Hiç gönderilmemiş: yalnızca özellikten SONRA ortaya çıkan ilan (eski ilanlar ilk gönderimde sessizce kaydedilir)
  const isNew = s ? s.first_seen_at != null : opts.fresh;
  if (isNew && it.price != null && lp != null && lp > 0 && Math.abs(lp - it.price) > Math.max(1, it.price * 0.01)) return { action: "skip", detect: "manual_new" };
  return { action: "push" };
}

// Stok sıfırlama (zero_missing / zero_unlinked): bağlı olmayan ilan. Kararlı ilan sıfırlanmaz; özellikten sonra eklenmiş, hiç
// gönderilmemiş ilan sıfırlanmadan önce sorulur.
export function decideZero(s: Sent | undefined, h: Hold | undefined, fresh: boolean): Decision {
  if (h) return h.status === "sync" ? { action: "push", resolve: true } : { action: "skip" };
  if (s?.pushed_at) return { action: "push" };
  return (s ? s.first_seen_at != null : fresh) ? { action: "skip", detect: "manual_new" } : { action: "push" };
}

type NewHold = { listing_key: string; kind: "edited" | "manual_new"; title: string | null; mp_price: number | null; mp_qty: number | null; our_price: number | null; our_qty: number | null; sent_price: number | null; sent_qty: number | null };

export async function loadGuard(db: any, marketplace: string, lsBy: Map<string, Listing>) {
  const h = await db.from("listing_holds").select("id, listing_key, status, kind, title").eq("marketplace", marketplace).limit(5000);
  if (h.error) return { off: `elle değişiklik koruması kapalı (migration 074 çalıştırılmamış: ${h.error.message.slice(0, 80)})` } as const;
  const sr = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, sent_price, sent_qty, price, stock, pushed_at, first_seen_at").eq("marketplace", marketplace).order("listing_key").range(a, b));
  if (sr.error) return { off: `elle değişiklik koruması kapalı (${sr.error.message.slice(0, 80)})` } as const;
  const holds = new Map<string, Hold>((h.data ?? []).map((x: any) => [x.listing_key, x]));
  const sent = new Map<string, Sent>(sr.data.map((x: any) => [x.listing_key, x]));
  const started = sr.data.some((x: any) => x.pushed_at); // koruma başlamış mı (ilk çalışmada her şey "yeni" sayılmasın)
  // Son 24 saatte satılan adet (stok 0 elle mi, satışla mı?)
  const sold = new Map<string, number>();
  {
    const since = new Date(Date.now() - 86400000).toISOString();
    const r = await db.from("order_lines").select("listing_key, qty, orders!inner(marketplace, ordered_at)").eq("orders.marketplace", marketplace).gte("orders.ordered_at", since).limit(5000);
    for (const x of r.data ?? []) if (x.listing_key) sold.set(x.listing_key, (sold.get(x.listing_key) ?? 0) + Number(x.qty ?? 1));
  }
  const found: NewHold[] = [];
  const resolved: string[] = [];
  const stats: Record<string, number> = { held: 0, keptPrice: 0, detectedEdited: 0, detectedNew: 0, resolved: 0, zeroHeld: 0 };
  const warnOos: { key: string; id: string; title: string; qty: number }[] = [];
  const holdRow = (it: InventoryItem | null, key: string, kind: "edited" | "manual_new"): NewHold => {
    const ls = lsBy.get(key), s = sent.get(key);
    return { listing_key: key, kind, title: ls?.title?.slice(0, 200) ?? null, mp_price: num(ls?.price), mp_qty: num(ls?.quantity), our_price: it?.price ?? null, our_qty: it?.quantity ?? null, sent_price: num(s?.sent_price), sent_qty: num(s?.sent_qty) };
  };

  return {
    off: null,
    stats,
    // Gönderilecek listeyi süz: bekleyen / kararlı ilanlar çıkar ya da yalnızca stok gider
    filter(items: InventoryItem[]): InventoryItem[] {
      const out: InventoryItem[] = [];
      for (const it of items) {
        const hold = holds.get(it.id), ls = lsBy.get(it.id);
        const d = decide(it, ls, sent.get(it.id), hold, { fresh: started && !sent.has(it.id), soldRecently: sold.get(it.id) ?? 0 });
        if (d.detect) { found.push(holdRow(it, it.id, d.detect)); stats[d.detect === "edited" ? "detectedEdited" : "detectedNew"]++; continue; }
        if (d.action === "skip") {
          stats.held++;
          if (hold?.status === "keep_all" && it.quantity === 0 && Number(ls?.quantity) > 0) warnOos.push({ key: it.id, id: hold.id, title: hold.title ?? ls?.title ?? it.id, qty: Number(ls?.quantity) });
          continue;
        }
        if (d.action === "qty_only") { stats.keptPrice++; out.push({ ...it, price: null }); continue; }
        if (d.resolve) { resolved.push(it.id); stats.resolved++; }
        out.push(it);
      }
      return out;
    },
    filterZero(ids: string[]): string[] {
      const out: string[] = [];
      for (const id of ids) {
        const d = decideZero(sent.get(id), holds.get(id), started && !sent.has(id));
        if (d.detect) { found.push(holdRow(null, id, d.detect)); stats.detectedNew++; continue; }
        if (d.action === "skip") { stats.zeroHeld++; continue; }
        if (d.resolve) { resolved.push(id); stats.resolved++; }
        out.push(id);
      }
      return out;
    },
    // Gönderimden sonra: yeni bekletmeleri yaz + Telegram, eşitlenenleri sil
    async finish(label: string) {
      if (resolved.length) for (const part of chunk(resolved, 200)) await db.from("listing_holds").delete().eq("marketplace", marketplace).eq("status", "sync").in("listing_key", part);
      const uniq = [...new Map(found.map((f) => [f.listing_key, f])).values()];
      let notified = 0;
      if (uniq.length) {
        const { data, error } = await db.from("listing_holds").upsert(uniq.map((f) => ({ marketplace, ...f })), { onConflict: "marketplace,listing_key", ignoreDuplicates: true }).select("id, listing_key");
        if (error) { stats.writeError = 1; console.error("listing_holds:", error.message); }
        const ids = new Map<string, string>((data ?? []).map((x: any) => [x.listing_key, x.id]));
        if (telegramEnabled()) {
          const list = uniq.filter((f) => ids.has(f.listing_key));
          for (const f of list.slice(0, 10)) {
            const id = ids.get(f.listing_key)!;
            const mid = await tgSend(holdText(label, f), holdButtons(id));
            if (mid) { notified++; await db.from("listing_holds").update({ tg_message_id: mid }).eq("id", id); }
          }
          if (list.length > 10) await tgSend(`✋ <b>${label}</b>: ${list.length - 10} ilan daha elle değiştirilmiş/eklenmiş görünüyor ve bekletiliyor. Panel → Gösterge paneli → "Elle değişen ilanlar"dan karar ver.`);
        }
      }
      for (const w of warnOos.slice(0, 5)) {
        await notifyOnce(db, `hold-oos:${w.id}`, `⚠️ <b>${label}</b>: elle bıraktığın ilanın tedarikçi stoğu bitti, pazaryerinde hâlâ <b>${w.qty}</b> adet satışta.\n${esc(w.title)}\n<code>${esc(w.key)}</code>`, holdButtons(w.id));
      }
      return { ...stats, newHolds: uniq.length, notified };
    },
  };
}

export type Guard = Exclude<Awaited<ReturnType<typeof loadGuard>>, { off: string }>;

const tl = (n: number | null) => (n == null ? "-" : `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`);
export function holdText(label: string, f: NewHold) {
  const head = f.kind === "edited" ? "✋ <b>Elle değişiklik</b>" : "🆕 <b>Elle eklenmiş ilan</b>";
  return `${head} · ${label}\n${esc(f.title ?? "")}\n<code>${esc(f.listing_key)}</code>\n\n` +
    `Pazaryerinde: <b>${tl(f.mp_price)}</b> · ${f.mp_qty ?? "-"} adet\n` +
    (f.our_price != null || f.our_qty != null ? `Sistem gönderecekti: ${tl(f.our_price)} · ${f.our_qty ?? "-"} adet\n` : "Sistem bu ilanın stoğunu 0 yapacaktı (tedarikçide karşılığı yok)\n") +
    (f.kind === "edited" && f.sent_price != null ? `Sistemin son gönderdiği: ${tl(f.sent_price)} · ${f.sent_qty ?? "-"} adet\n` : "") +
    `\nKarar verene kadar bu ilana dokunulmuyor.`;
}
export const holdButtons = (id: string) => [
  [{ text: "Hepsi kalsın", data: `hl:a:${id}` }, { text: "Fiyat kalsın, stok sistemden", data: `hl:p:${id}` }],
  [{ text: "Sistemle eşitle", data: `hl:s:${id}` }],
];
