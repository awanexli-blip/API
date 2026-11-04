// Sunucu tedarikçilerinin (Hepsibayi, Bezos) siparişlerini tamamla (K, 04.11: "bilinmeyen tedarikçi diye bir şey yok").
// Siparişleri Supabase (GitHub senkronu) işliyor; bu ürünler yalnızca sunucu veritabanında olduğu için satırda maliyet ve tedarikçi kodu boş kalıyordu.
// Bu betik (sunucu, 3 dakikada bir): Supabase'de maliyeti boş sipariş satırlarını sunucu veritabanındaki ilan -> ürün kaydından doldurur
// (cost_snapshot = tedarikçi maliyeti × kur, fiyat motoruyla aynı; supplier_sku = tedarikçi kodu BZS…/HBY…). Sonraki Supabase senkronu kârı
// bu maliyetle hesaplar (order_upsert dolu değeri korur) ve Telegram bildirimini tedarikçiyle gönderir (inbox.ts notifyOrders).
// Yalnızca boş alanları yazar; müşteri bilgisi okunmaz. Tam taşımadan sonra gereksizdir (tek veritabanı).
// Ortam: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (canlı Supabase), VPS_SUPABASE_URL/VPS_SERVICE_ROLE_KEY (sunucu). DRY=1: yalnızca sayar.
import { createClient } from "@supabase/supabase-js";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} yok`); return v; };
const live = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const vps = createClient(need("VPS_SUPABASE_URL"), need("VPS_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const dry = process.env.DRY === "1";
const days = Number(process.env.ORDER_DAYS ?? 14);

const since = new Date(Date.now() - days * 86400000).toISOString();
// 077: KDV oranı boş sunucu ürünü satırları (maliyeti önceden doldurulmuşlar da) -> ürünün KDV oranı (fatura için)
{
  const { data: nv } = await live.from("order_lines").select("order_id, line_no, listing_key, orders!inner(marketplace, created_at)").is("vat_rate", null).or("supplier_sku.like.BZS%,supplier_sku.like.HBY%").gte("orders.created_at", since).limit(1000);
  const by = new Map<string, any[]>();
  for (const r of (nv ?? []) as any[]) by.set(r.orders.marketplace, [...(by.get(r.orders.marketplace) ?? []), r]);
  let n = 0;
  for (const [mp, list] of by) {
    const keys = [...new Set(list.map((r) => r.listing_key as string))];
    const vr = new Map<string, number>();
    for (let i = 0; i < keys.length; i += 200) {
      const { data } = await vps.from("marketplace_listings").select("listing_key, products(vat_rate)").eq("marketplace", mp).in("listing_key", keys.slice(i, i + 200));
      for (const x of (data ?? []) as any[]) if (x.products?.vat_rate != null) vr.set(x.listing_key, Number(x.products.vat_rate));
    }
    for (const r of list) {
      const v = vr.get(r.listing_key);
      if (v == null || dry) continue;
      const { error: ve } = await live.from("order_lines").update({ vat_rate: v }).eq("order_id", r.order_id).eq("line_no", r.line_no).is("vat_rate", null);
      if (!ve) n++;
    }
  }
  console.log(JSON.stringify({ vatFilled: n, vatCandidates: nv?.length ?? 0 }));
}
// Maliyeti boş, ürüne bağlı olmayan satırlar (KENDI işaretliler de: sonradan panele eklenen ürünle eşleşebilir)
const { data: rows, error } = await live.from("order_lines").select("order_id, line_no, listing_key, title, orders!inner(marketplace, created_at)")
  .is("cost_snapshot", null).is("product_id", null).or("supplier_sku.is.null,supplier_sku.eq.KENDI").not("listing_key", "is", null).gte("orders.created_at", since).limit(1000);
if (error) throw new Error(`sipariş satırları okunamadı: ${error.message}`);
const { data: st } = await live.from("settings").select("fx_usd, fx_eur").maybeSingle();
const fx: Record<string, number> = { TL: 1, TRY: 1, USD: Number(st?.fx_usd ?? 0), EUR: Number(st?.fx_eur ?? 0) };

const OWN_SKU = "KENDI";
// K'nın panelden eklediği kendi ürünleri (source manual). Pazaryerinde elle açılmış eski ilan (ör. Gezer 10221.*) bu ürünlere bağlı değil:
// başlık benzerliği tek ve net ise (Jaccard >= 0,8, ikinciden en az 0,15 fark) o ürünün maliyeti. Emin değilse maliyet yazılmaz.
const { data: manual } = await live.from("products").select("id, title, sku, cost_price, currency").eq("source", "manual").eq("status", "active").limit(500);
const words = (t: string) => new Set(String(t ?? "").toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1));
const manualW = (manual ?? []).map((m: any) => ({ m, w: words(m.title) }));
function ownMatch(title: string) {
  const a = words(title);
  if (!a.size) return null;
  const sc = manualW.map(({ m, w }) => { let i = 0; for (const x of a) if (w.has(x)) i++; return { m, j: i / (a.size + w.size - i) }; }).sort((x, y) => y.j - x.j);
  return sc[0] && sc[0].j >= 0.8 && (!sc[1] || sc[0].j - sc[1].j >= 0.15) ? sc[0].m : null;
}
const out = { lines: rows?.length ?? 0, filled: 0, own: 0, ownMatched: 0, notFound: 0, noCost: 0, errors: 0 };
const byMp = new Map<string, any[]>();
for (const r of rows ?? []) { const mp = (r as any).orders.marketplace; byMp.set(mp, [...(byMp.get(mp) ?? []), r]); }
for (const [mp, list] of byMp) {
  const keys = [...new Set(list.map((r) => r.listing_key as string))];
  const ref = new Map<string, { cost: number | null; sku: string | null; product_id?: string }>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error: e } = await vps.from("marketplace_listings").select("listing_key, product_variants(cost_price), products(cost_price, currency, sku)")
      .eq("marketplace", mp).in("listing_key", keys.slice(i, i + 200));
    if (e) throw new Error(`sunucu ilanları okunamadı: ${e.message}`);
    for (const x of (data ?? []) as any[]) {
      const p = x.products, v = x.product_variants;
      if (!p) continue;
      const c = Number(v?.cost_price ?? p.cost_price) * (fx[p.currency ?? "TRY"] ?? 0);
      ref.set(x.listing_key, { cost: Number.isFinite(c) && c > 0 ? Math.round(c * 100) / 100 : null, sku: p.sku ?? null });
    }
  }
  for (const r of list) {
    // Hiçbir tedarikçide yok (Supabase'de ürünü yok, sunucuda yok): K'nın pazaryerinde elle açtığı kendi ürünü (ör. Gezer terlik 10221.*).
    // Eski BayilikXML (ÖS13-/OS13-) ilanları ayrı etiketlenir (inbox.ts supplierOfBarcode). Maliyet yok: K bilir / panelden girer.
    const own = ref.has(r.listing_key) ? null : ownMatch(r.title);
    const ownCost = own ? Number(own.cost_price) * (fx[own.currency ?? "TRY"] ?? 0) : NaN;
    const f = ref.get(r.listing_key) ?? (own ? { cost: ownCost > 0 ? Math.round(ownCost * 100) / 100 : null, sku: own.sku ?? OWN_SKU, product_id: own.id }
      : /^(ÖS13-|OS13-)/i.test(r.listing_key) ? null : { cost: null, sku: OWN_SKU });
    if (!f) { out.notFound++; continue; }
    if (own) out.ownMatched++; else if (f.sku === OWN_SKU) out.own++;
    if (f.cost == null && f.sku !== OWN_SKU) out.noCost++;
    if (dry) { out.filled++; continue; }
    if (f.sku === OWN_SKU && !("product_id" in f)) { // zaten KENDI ise yeniden yazma
      const { error: ke } = await live.from("order_lines").update({ supplier_sku: OWN_SKU }).eq("order_id", r.order_id).eq("line_no", r.line_no).is("supplier_sku", null);
      if (ke) { out.errors++; console.error("satır yazılamadı:", ke.message.slice(0, 150)); } else out.filled++;
      continue;
    }
    const { error: ue } = await live.from("order_lines").update({ cost_snapshot: f.cost, supplier_sku: f.sku, ...(f.product_id ? { product_id: f.product_id } : {}) }).eq("order_id", r.order_id).eq("line_no", r.line_no).is("cost_snapshot", null);
    if (ue) { out.errors++; console.error("satır yazılamadı:", ue.message.slice(0, 150)); } else out.filled++;
  }
}
console.log(JSON.stringify({ dry, ...out }));
