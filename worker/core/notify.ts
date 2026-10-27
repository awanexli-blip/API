// Telegram uyarıları (K, 27.10: "önemli her şey Telegram'dan, hızlı"): her senkron sonunda kontrol edilir, aynı olay bir kez gönderilir
// (notifications tablosu, migration 060). Müşteri adı/adresi/telefonu mesaja girmez.
// Olaylar: iade talebi, müşteri iptali, kargo süresi yaklaşan/geçen sipariş, senkron hatası (3 saatte en çok bir), veritabanı 400 MB,
// günlük satış özeti (09:00 sonrası ilk Trendyol senkronu). Yeni sipariş ve müşteri sorusu bildirimleri inbox.ts'te.
import { esc, telegramEnabled, tgSend } from "./telegram.ts";

const TR = (d = new Date()) => new Date(d.getTime() + 3 * 3600 * 1000); // Türkiye saati (UTC+3)
const day = (d: Date) => d.toISOString().slice(0, 10);
const tl = (n: unknown) => `${Number(n ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} TL`;
const OPEN_CLAIM = ["Created", "WaitingInAction", "InAnalysis", "Unresolved"];

// Anahtar daha önce gönderilmediyse gönder ve kaydet. Gönderilemezse kaydedilmez (sonraki turda yeniden denenir).
export async function notifyOnce(db: any, key: string, text: string, buttons?: { text: string; data: string }[][]): Promise<boolean> {
  if (!telegramEnabled()) return false;
  const { data } = await db.from("notifications").select("key").eq("key", key).maybeSingle();
  if (data) return false;
  const id = await tgSend(text, buttons);
  if (!id) return false;
  await db.from("notifications").insert({ key });
  return true;
}

export async function runAlerts(db: any, mp: { id: string; label: string }, summary: any, status: string) {
  if (!telegramEnabled()) return { skipped: "telegram yok" };
  const out: Record<string, number> = {};
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  const now = new Date();

  // 1) İade talepleri (son 3 gün, açık)
  {
    const { data } = await db.from("claims").select("claim_id, order_no, status, reason, amount, lines, claimed_at").eq("marketplace", mp.id).gte("claimed_at", new Date(now.getTime() - 3 * 86400000).toISOString()).in("status", OPEN_CLAIM).limit(30);
    for (const c of data ?? []) {
      const items = (Array.isArray(c.lines) ? c.lines : []).map((l: any) => `${l.qty ?? 1} × ${esc(l.title ?? "")}`).join("\n");
      if (await notifyOnce(db, `claim:${mp.id}:${c.claim_id}`, `↩️ <b>İade talebi</b> (${esc(mp.label)}) ${esc(c.order_no ?? "")}\n${items}\n<b>Tutar:</b> ${tl(c.amount)}${c.reason ? `\n<b>Neden:</b> ${esc(c.reason)}` : ""}\nPanelde: Siparişler`)) add("iade");
    }
  }
  // 2) Müşteri iptalleri: yalnızca GERÇEK durum değişikliği (son 2 günde iptal olmayan bir paketin iptale dönmesi; order_events "status").
  //    Sisteme ilk kez iptal olarak gelen (geçmiş siparişlerin yeniden çekilmesi, 26.10 veritabanı yeniden kurulumu) bildirilmez.
  //    Aynı siparişin iptal olmayan başka paketi varsa (Trendyol paketi böldü / yeniden oluşturdu, sipariş sürüyor) bildirilmez (27.10 hatalı uyarı).
  {
    const { data: ev } = await db.from("order_events").select("order_id, detail, at").eq("kind", "status").gte("at", new Date(now.getTime() - 2 * 86400000).toISOString()).limit(500);
    const ids = [...new Set((ev ?? []).filter((e: any) => e.detail?.status === "cancelled" && e.detail?.from && !/cancel/i.test(String(e.detail.from))).map((e: any) => e.order_id))];
    if (ids.length) {
      const { data } = await db.from("orders").select("id, order_no, total, status, order_lines(title, qty)").eq("marketplace", mp.id).eq("status", "cancelled").in("id", ids.slice(0, 50));
      for (const o of data ?? []) {
        if (o.order_no) {
          const { data: sib } = await db.from("orders").select("id, status").eq("marketplace", mp.id).eq("order_no", o.order_no).neq("id", o.id);
          if ((sib ?? []).some((x: any) => x.status !== "cancelled")) continue; // paket bölündü/yenilendi: sipariş iptal değil
        }
        const items = (o.order_lines ?? []).map((l: any) => `${l.qty} × ${esc(l.title)}`).join("\n");
        if (await notifyOnce(db, `cancel:${o.id}`, `❌ <b>Sipariş iptal edildi</b> (${esc(mp.label)}) ${esc(o.order_no ?? "")}\n${items}\n<b>Tutar:</b> ${tl(o.total)}\nTedarikçiye verildiyse iptal et.`)) add("iptal");
      }
    }
  }
  // 3) Kargo süresi: 6 saatten az kalan ve geçmiş, henüz kargolanmamış siparişler
  {
    const { data } = await db.from("orders").select("id, order_no, ship_deadline, status, order_lines(title, qty)").eq("marketplace", mp.id).in("status", ["new", "ready", "sent_to_supplier"]).gte("last_seen_at", new Date(now.getTime() - 6 * 3600000).toISOString()).not("ship_deadline", "is", null).lte("ship_deadline", new Date(now.getTime() + 6 * 3600000).toISOString()).limit(30);
    for (const o of data ?? []) {
      const late = new Date(o.ship_deadline).getTime() < now.getTime();
      const items = (o.order_lines ?? []).map((l: any) => `${l.qty} × ${esc(l.title)}`).join("\n");
      const when = TR(new Date(o.ship_deadline)).toISOString().slice(5, 16).replace("T", " ");
      if (await notifyOnce(db, `ship:${o.id}:${late ? "late" : "soon"}`, `${late ? "🚨 <b>Kargo süresi GEÇTİ</b>" : "⏰ <b>Kargo süresi yaklaşıyor</b>"} (${esc(mp.label)}) ${esc(o.order_no ?? "")}\n${items}\n<b>Son gün:</b> ${when}${o.status === "new" ? "\nTedarikçiye henüz verilmedi." : ""}`)) add(late ? "kargo_gecti" : "kargo_yakin");
    }
  }
  // 4) Senkron sorunu (3 saatte en çok bir uyarı)
  if (status === "error" || status === "partial") {
    const slot = `${day(now)}T${String(Math.floor(now.getUTCHours() / 3) * 3).padStart(2, "0")}`;
    const why = summary?.pushErrors?.[0] ?? summary?.error ?? (summary?.failedBatches ? `${summary.failedBatches} toplu gönderim başarısız` : "");
    if (await notifyOnce(db, `sync:${mp.id}:${slot}`, `⚠️ <b>${esc(mp.label)} senkronunda sorun</b>\n${esc(String(why).slice(0, 300))}\nGüncellenen: ${Number(summary?.updated ?? 0).toLocaleString("tr-TR")} ilan. Sorun sürerse Claude'a bildir.`)) add("senkron");
  }
  // 5) Veritabanı boyutu (ücretsiz plan 500 MB)
  {
    const { data: size } = await db.rpc("db_size_bytes");
    const mb = Number(size ?? 0) / 1048576;
    if (mb >= 400 && await notifyOnce(db, `db:${day(now)}`, `🗄️ <b>Veritabanı ${Math.round(mb)} MB</b> (ücretsiz sınır 500 MB). Dolarsa sistem durur, Claude'a bildir.`)) add("db");
  }
  // 6) Günlük özet (Türkiye 09:00 sonrası ilk Trendyol senkronunda; dün, tüm pazaryerleri)
  if (mp.id === "trendyol" && TR(now).getUTCHours() >= 9) {
    const today = day(TR(now));
    const from = new Date(`${today}T00:00:00+03:00`), y = new Date(from.getTime() - 86400000);
    const { data: k } = await db.rpc("sales_kpi", { p_from: y.toISOString(), p_to: from.toISOString(), p_mp: null });
    const { count: rej } = await db.from("marketplace_listings").select("listing_key", { count: "exact", head: true }).in("status", ["rejected", "error"]).gte("updated_at", y.toISOString());
    const { count: open } = await db.from("orders").select("id", { count: "exact", head: true }).in("status", ["new", "ready"]);
    const text = `📊 <b>Dünün özeti</b> (${day(y)})\nSipariş: <b>${k?.orders ?? 0}</b> · ${tl(k?.gross)}\nTahmini net kâr: <b>${tl(k?.net)}</b>\nİptal: ${k?.cancelled ?? 0} · İade: ${k?.returned ?? 0}\nTedarikçiye verilmeyi bekleyen sipariş: ${open ?? 0}\nReddedilen/hatalı ilan (24 saat): ${rej ?? 0}`;
    if (await notifyOnce(db, `daily:${today}`, text)) add("gunluk");
  }
  // 7) Rekabet önerileri (günde bir, Trendyol): onay panelde (Pazaryeri > Rekabet > Öneriler)
  if (mp.id === "trendyol") {
    const { data: rows } = await db.from("listing_buybox").select("suggestion").eq("marketplace", "trendyol").not("suggestion", "is", null).limit(5000);
    const c = { lower: 0, raise: 0, reset: 0 } as Record<string, number>;
    for (const r of rows ?? []) c[r.suggestion] = (c[r.suggestion] ?? 0) + 1;
    const total = c.lower + c.raise + c.reset;
    if (total && await notifyOnce(db, `buybox:${day(TR(now))}`, `🏷️ <b>${total} rekabet önerisi</b> (güncel fiyatlarla)\nİn (buybox al): ${c.lower} · Artır: ${c.raise} · Formüle dön: ${c.reset}\nPanel → Trendyol → Rekabet → Öneriler: karşılaştır, seç, onayla.`)) add("rekabet");
  }
  return out;
}
