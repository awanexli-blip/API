// Telegram durum asistanının araçları: sabit, parametreli, SALT OKUNUR sorgular (yalnızca select; insert/update/delete yok).
// Müşteri kolonları (customer_name, customer_phone, address, city, supplier_note) hiçbir sorguda seçilmez.
import { admin } from "@/lib/server";
import { questionStatus, searchTerm, shortReason, trTime, type ToolDef } from "./assistant-core.ts";

const MPS = ["trendyol", "hepsiburada", "amazon"];
const mpArg = (v: unknown) => (MPS.includes(String(v)) ? String(v) : null);
const int = (v: unknown, def: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v) || def)));
const OPEN_ORDER = ["delivered", "cancelled", "returned", "undelivered"];

async function questions(a: Record<string, unknown>) {
  const db = admin();
  let q = db.from("inbox_items").select("marketplace, product_title, text, status, approved_by, approved_at, answered_at, last_error, asked_at, created_at")
    .eq("kind", "question").order("created_at", { ascending: false }).limit(int(a.adet, 5, 10));
  const term = searchTerm(a.ara);
  if (term) q = q.or(`product_title.ilike.%${term}%,text.ilike.%${term}%`);
  if (a.sadece_sorunlu === true) q = q.in("status", ["failed", "approved", "sending", "new", "drafted"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const s of ["new", "drafted", "approved", "sending", "failed"]) {
    const { count } = await db.from("inbox_items").select("id", { count: "exact", head: true }).eq("kind", "question").eq("status", s);
    if (count) counts[questionStatus(s)] = count;
  }
  return {
    bekleyen_ve_sorunlu_sayilari: counts,
    sorular: (data ?? []).map((r: any) => ({
      pazaryeri: r.marketplace, urun: String(r.product_title ?? "").slice(0, 100), soru: String(r.text ?? "").slice(0, 160),
      durum: questionStatus(r.status), hata_nedeni: r.status === "failed" ? shortReason(r.last_error) : null,
      soruldu: trTime(r.asked_at ?? r.created_at), onaylandi: trTime(r.approved_at), onaylayan: r.approved_by ?? null, iletildi: trTime(r.answered_at),
    })),
  };
}

const RUN_STATUS: Record<string, string> = { ok: "başarılı", error: "hata ile bitti", partial: "kısmen başarılı", running: "çalışıyor", skipped: "atlandı" };
async function syncs(a: Record<string, unknown>) {
  const db = admin(), only = mpArg(a.pazaryeri);
  const out: Record<string, unknown> = {};
  for (const mp of only ? [only] : MPS) {
    const { data, error } = await db.from("sync_runs").select("mode, trigger, status, started_at, finished_at, error, summary").eq("marketplace", mp).order("started_at", { ascending: false }).limit(3);
    if (error) throw new Error(error.message);
    out[mp] = (data ?? []).map((r: any) => {
      const s = r.summary ?? {};
      return {
        durum: RUN_STATUS[r.status] ?? r.status, mod: r.mode === "auto" ? "otomatik" : r.mode === "update" ? "elle güncelleme" : r.mode, baslangic: trTime(r.started_at), sure_dk: r.finished_at ? Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 60000) : null,
        hata: r.error ? shortReason(r.error) : null, atlandi: s.skippedRun ?? null, satis_durduruldu: s.salesPaused ?? null,
        guncellenen_ilan: s.update ?? s.updated ?? null, yeni_acilan: s.created ?? null, basarisiz_paket: s.failedBatches ?? null,
        pazaryeri_ret_sayisi: s.batchCheck?.failedItems ?? null, ret_nedenleri: (s.batchCheck?.reasons ?? []).slice(0, 3).map((x: any) => String(x?.reason ?? x).slice(0, 120)),
        gonderim_hatalari: (s.pushErrors ?? []).slice(0, 2).map((x: unknown) => String(x).slice(0, 120)),
      };
    });
  }
  return out;
}

async function listings(a: Record<string, unknown>) {
  const db = admin(), only = mpArg(a.pazaryeri);
  const out: Record<string, unknown> = {};
  for (const mp of only ? [only] : ["trendyol", "hepsiburada"]) {
    const counts: Record<string, number> = {};
    for (const s of ["live", "error", "rejected", "pending_approval", "queued", "sent", "closed"]) {
      const { count } = await db.from("marketplace_listings").select("listing_key", { count: "exact", head: true }).eq("marketplace", mp).eq("status", s);
      counts[s] = count ?? 0;
    }
    const { data } = await db.from("marketplace_listings").select("last_error, mp_reasons").eq("marketplace", mp).in("status", ["error", "rejected"]).order("updated_at", { ascending: false }).limit(300);
    const by = new Map<string, number>();
    for (const r of data ?? []) {
      const raw = (Array.isArray(r.mp_reasons) && r.mp_reasons.length ? r.mp_reasons.join("; ") : r.last_error) ?? "neden yok";
      const k = String(shortReason(raw) ?? raw).replace(/\d+/g, "#").slice(0, 110);
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    out[mp] = {
      sayilar: { yayinda: counts.live, hata: counts.error, reddedilen: counts.rejected, onay_bekleyen: counts.pending_approval, sirada: counts.queued + counts.sent, kapali: counts.closed },
      son_300_hata_ret_nedenleri: [...by].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([neden, adet]) => ({ neden, adet })),
    };
  }
  return out;
}

const ORDER_COLS = "marketplace, order_no, status, marketplace_status, total, ordered_at, ship_deadline, cargo_provider, tracking_no, needs_attention, attention_reason, sent_to_supplier_at, supplier_tracking, tracking_push, tracking_push_error";
const ORDER_STATUS: Record<string, string> = { new: "yeni (onay bekliyor)", ready: "hazırlanıyor, henüz kargolanmadı", picking: "hazırlanıyor", shipped: "kargoda", delivered: "teslim edildi", cancelled: "iptal edildi", returned: "iade edildi", undelivered: "teslim edilemedi" };
const orderRow = (r: any) => ({
  pazaryeri: r.marketplace, siparis_no: r.order_no, durum: ORDER_STATUS[r.status] ?? r.status, pazaryeri_durumu: r.marketplace_status, tutar: r.total,
  siparis_zamani: trTime(r.ordered_at), son_kargolama: trTime(r.ship_deadline), kargo: r.cargo_provider, takip_no: r.tracking_no,
  dikkat: r.needs_attention ? r.attention_reason ?? "evet" : null, tedarikciye_iletildi: trTime(r.sent_to_supplier_at),
  tedarikci_takip: r.supplier_tracking ?? null, takip_pazaryerine: r.tracking_push ?? null, takip_hatasi: r.tracking_push_error ? shortReason(r.tracking_push_error) : null,
});
async function orders(a: Record<string, unknown>) {
  const db = admin();
  const no = String(a.siparis_no ?? "").replace(/\D/g, "").slice(0, 20);
  if (no) {
    const { data, error } = await db.from("orders").select(ORDER_COLS).eq("order_no", no).limit(3);
    if (error) throw new Error(error.message);
    return data?.length ? { siparisler: data.map(orderRow) } : { bulunamadi: `Sipariş ${no} kayıtlarda yok` };
  }
  const open = await db.from("orders").select("id", { count: "exact", head: true }).not("status", "in", `(${OPEN_ORDER.join(",")})`);
  const att = await db.from("orders").select(ORDER_COLS).eq("needs_attention", true).not("status", "in", `(${OPEN_ORDER.join(",")})`).order("ship_deadline", { ascending: true }).limit(int(a.adet, 5, 10));
  const soon = await db.from("orders").select("id", { count: "exact", head: true }).in("status", ["new", "ready", "created", "picking"])
    .lt("ship_deadline", new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  const last = await db.from("orders").select(ORDER_COLS).order("ordered_at", { ascending: false }).limit(int(a.adet, 5, 10));
  if (att.error) throw new Error(att.error.message);
  return { acik_siparis: open.count ?? 0, kargolama_suresi_24_saatten_az: soon.count ?? 0, dikkat_gerektiren: (att.data ?? []).map(orderRow), son_siparisler: (last.data ?? []).map(orderRow) };
}

async function jobs() {
  const db = admin(), since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const counts: Record<string, number> = {};
  for (const s of ["queued", "running", "failed", "done"]) {
    const { count } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("status", s).gte("created_at", since);
    counts[s] = count ?? 0;
  }
  const { data } = await db.from("jobs").select("type, marketplace, last_error, updated_at").eq("status", "failed").order("updated_at", { ascending: false }).limit(5);
  return { son_48_saat: { sirada: counts.queued, calisiyor: counts.running, hata: counts.failed, bitti: counts.done },
    son_hatalar: (data ?? []).map((r: any) => ({ is: r.type, pazaryeri: r.marketplace, neden: shortReason(r.last_error), zaman: trTime(r.updated_at) })) };
}

async function overview() {
  const [q, s, l, o, j] = await Promise.all([questions({ adet: 3, sadece_sorunlu: true }), syncs({}), listings({}), orders({ adet: 3 }), jobs()]);
  const lastRun = Object.fromEntries(Object.entries(s as Record<string, any[]>).map(([mp, runs]) => [mp, runs[0] ?? null]));
  return { sorular: q, son_senkronlar: lastRun, ilanlar: l, siparisler: { acik: (o as any).acik_siparis, kargolama_24_saat: (o as any).kargolama_suresi_24_saatten_az, dikkat: (o as any).dikkat_gerektiren }, isler: j };
}

const mpParam = { pazaryeri: { type: "STRING", enum: MPS, description: "Boş: hepsi" } };
export const TOOLS: ToolDef[] = [
  { name: "genel_ozet", description: "Sistemin genel durumu: bekleyen/sorunlu sorular, son senkronlar, ilan hataları, açık ve dikkat gerektiren siparişler, iş kuyruğu. 'Ne durumdayız', 'sorun var mı' gibi sorularda.", parameters: { type: "OBJECT", properties: {} }, run: overview },
  { name: "soru_durumu", description: "Müşteri soruları ve verilen cevabın pazaryerine iletilip iletilmediği (İletildi / Gönderim denendi ama hata aldı / Bekliyor). Ürün adı ya da sorudaki bir kelimeyle aranabilir.", parameters: { type: "OBJECT", properties: { ara: { type: "STRING", description: "Ürün adında / soruda geçen kelime (isteğe bağlı)" }, adet: { type: "INTEGER", description: "1-10, varsayılan 5" }, sadece_sorunlu: { type: "BOOLEAN", description: "Yalnızca cevap bekleyen / gönderilemeyenler" } } }, run: questions },
  { name: "senkron_durumu", description: "Stok/fiyat senkronlarının son 3 çalışması: başarılı mı, hata nedeni, güncellenen ilan, pazaryerinin reddettiği paketler.", parameters: { type: "OBJECT", properties: mpParam }, run: syncs },
  { name: "ilan_sorunlari", description: "Pazaryerindeki ilanların durum sayıları (yayında, hata, reddedilen, onay bekleyen, kapalı) ve en sık hata/ret nedenleri.", parameters: { type: "OBJECT", properties: mpParam }, run: listings },
  { name: "siparis_durumu", description: "Sipariş durumu. Sipariş numarası verilirse o sipariş; verilmezse açık sipariş sayısı, kargolama süresi dolmak üzere olanlar, dikkat gerektirenler, son siparişler. Müşteri bilgisi içermez.", parameters: { type: "OBJECT", properties: { siparis_no: { type: "STRING", description: "Pazaryeri sipariş numarası (isteğe bağlı)" }, adet: { type: "INTEGER", description: "1-10" } } }, run: orders },
  { name: "is_kuyrugu", description: "Arka plan işleri (pazaryerine gönderim kuyruğu vb.): son 48 saatte sırada/hata sayıları ve son hatalar.", parameters: { type: "OBJECT", properties: {} }, run: jobs },
];
