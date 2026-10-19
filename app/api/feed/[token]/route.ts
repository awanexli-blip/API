import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { calcPrice, defaultConfig } from "@/worker/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Herkese açık XML feed: /api/feed/<token>. Token gizli adres yerine geçer (panelden yenilenir/silinir).
// Yalnızca "aktif" ürünler. Fiyat: none = yok, cost = alış (KDV dahil), formula = Trendyol fiyat ayarlarıyla hesaplanan satış fiyatı.
const esc = (s: unknown) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
const cdata = (s: unknown) => `<![CDATA[${String(s ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;
  if (!/^[a-f0-9]{32,64}$/.test(params.token)) return new NextResponse("Bulunamadı", { status: 404 });
  const db = admin();
  const { data: feed } = await db.from("feeds").select("*").eq("token", params.token).maybeSingle();
  if (!feed) return new NextResponse("Bulunamadı", { status: 404 });

  let cfg: any = null, fx: Record<string, number> = { TRY: 1 };
  if (feed.price_mode === "formula" || feed.price_mode === "cost") {
    const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
    fx = { TRY: 1, USD: Number(s?.fx_usd) || 0, EUR: Number(s?.fx_eur) || 0 };
    cfg = {
      ...defaultConfig, commissionRate: Number(s?.commission_rate), targetProfitRate: Number(s?.target_profit_rate), shippingCost: Number(s?.shipping_cost),
      freeShippingThreshold: Number(s?.free_shipping_threshold), minMarkup: Number(s?.min_markup), fixedCost: Number(s?.fixed_cost),
      returnRate: Number(s?.return_rate ?? 0), returnCost: Number(s?.return_cost ?? 0), squeezeMinNet: s?.squeeze_min_net != null ? Number(s.squeeze_min_net) : null, multiUnitMinNet: s?.multi_unit_min_net != null ? Number(s.multi_unit_min_net) : null,
      minAcceptableProfitRate: Number(s?.min_acceptable_profit_rate), maxPrice: Number(s?.max_price), commissionPlusVat: s?.commission_plus_vat === true,
    };
  }

  const out: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, `<products generated="${new Date().toISOString()}">`];
  let count = 0;
  for (let from = 0; ; from += 500) {
    let q = db.from("products")
      .select("id, sku, title, description, brand, category, vat_rate, desi, cost_price, currency, attributes, product_variants(sku, barcode, attributes, stock, reserved, cost_price, position), product_images(url, position)")
      .eq("status", "active").order("sku").range(from, from + 499);
    if (feed.source_filter) q = q.eq("source", feed.source_filter);
    const { data, error } = await q;
    if (error) return new NextResponse("Feed oluşturulamadı", { status: 500 });
    for (const p of data ?? []) {
      const vars = [...(p.product_variants as any[])].sort((a, b) => a.position - b.position).map((v) => ({ ...v, available: Math.max(0, v.stock - v.reserved) }));
      if (feed.only_in_stock && !vars.some((v) => v.available > 0)) continue;
      const imgs = [...(p.product_images as any[])].sort((a, b) => a.position - b.position).map((i) => i.url);
      const priceOf = (cost: number | null) => {
        if (cost == null || !cfg) return null;
        const tl = Number(cost) * (fx[p.currency] ?? 0);
        if (!(tl > 0)) return null;
        if (feed.price_mode === "cost") return Math.round(tl * 100) / 100;
        const r = calcPrice(tl, { ...cfg, vatRate: Number(p.vat_rate) / 100 });
        return r.ok ? r.price : null;
      };
      out.push(`<product>`,
        `<sku>${esc(p.sku)}</sku>`, `<title>${cdata(p.title)}</title>`, `<description>${cdata(p.description)}</description>`,
        `<brand>${esc(p.brand)}</brand>`, `<category>${cdata(p.category)}</category>`, `<vat>${p.vat_rate}</vat>`,
        p.desi != null ? `<desi>${p.desi}</desi>` : "",
        `<stock>${vars.reduce((t, v) => t + v.available, 0)}</stock>`,
        `<images>${imgs.map((u) => `<image>${esc(u)}</image>`).join("")}</images>`,
        Object.keys(p.attributes ?? {}).length ? `<attributes>${Object.entries(p.attributes).map(([k, v]) => `<attribute name="${esc(k)}">${esc(v)}</attribute>`).join("")}</attributes>` : "",
        `<variants>`,
        ...vars.map((v) => {
          const price = priceOf(v.cost_price ?? p.cost_price);
          return `<variant><sku>${esc(v.sku)}</sku><barcode>${esc(v.barcode)}</barcode><stock>${v.available}</stock>${price != null ? `<price currency="TRY">${price.toFixed(2)}</price>` : ""}` +
            `${Object.keys(v.attributes ?? {}).length ? `<attributes>${Object.entries(v.attributes).map(([k, val]) => `<attribute name="${esc(k)}">${esc(val)}</attribute>`).join("")}</attributes>` : ""}</variant>`;
        }),
        `</variants>`, `</product>`);
      count++;
    }
    if (!data || data.length < 500) break;
  }
  out.push(`</products>`);
  // Erişim istatistiği (yanıtı bekletmez)
  db.from("feeds").update({ last_access_at: new Date().toISOString(), access_count: (feed.access_count ?? 0) + 1 }).eq("id", feed.id).then(() => {});
  return new NextResponse(out.filter(Boolean).join("\n"), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Product-Count": String(count) },
  });
}
