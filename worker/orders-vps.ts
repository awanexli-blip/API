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
const { data: rows, error } = await live.from("order_lines").select("order_id, line_no, listing_key, orders!inner(marketplace, created_at)")
  .is("cost_snapshot", null).is("product_id", null).not("listing_key", "is", null).gte("orders.created_at", since).limit(1000);
if (error) throw new Error(`sipariş satırları okunamadı: ${error.message}`);
const { data: st } = await live.from("settings").select("fx_usd, fx_eur").maybeSingle();
const fx: Record<string, number> = { TL: 1, TRY: 1, USD: Number(st?.fx_usd ?? 0), EUR: Number(st?.fx_eur ?? 0) };

const out = { lines: rows?.length ?? 0, filled: 0, notFound: 0, noCost: 0, errors: 0 };
const byMp = new Map<string, any[]>();
for (const r of rows ?? []) { const mp = (r as any).orders.marketplace; byMp.set(mp, [...(byMp.get(mp) ?? []), r]); }
for (const [mp, list] of byMp) {
  const keys = [...new Set(list.map((r) => r.listing_key as string))];
  const ref = new Map<string, { cost: number | null; sku: string | null }>();
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
    const f = ref.get(r.listing_key);
    if (!f) { out.notFound++; continue; }
    if (f.cost == null) out.noCost++;
    if (dry) { out.filled++; continue; }
    const { error: ue } = await live.from("order_lines").update({ cost_snapshot: f.cost, supplier_sku: f.sku }).eq("order_id", r.order_id).eq("line_no", r.line_no).is("cost_snapshot", null);
    if (ue) { out.errors++; console.error("satır yazılamadı:", ue.message.slice(0, 150)); } else out.filled++;
  }
}
console.log(JSON.stringify({ dry, ...out }));
