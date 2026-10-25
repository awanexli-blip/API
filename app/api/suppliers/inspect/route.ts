import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { admin } from "@/lib/server";
import { authorize } from "@/lib/products";
import { safeFetch } from "@/worker/core/safe-fetch";
import { fieldStats, findItems, itemsToGroups, suggestMapping, supplierPayload } from "@/lib/supplier-xml";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX = 120 * 1024 * 1024;

// XML'i incele: { id } (kayıtlı adres), { id, feed_id } (kayıtlı ek link) veya { url } (yeni) + isteğe bağlı { item_path, mapping, ...ayarlar } (önizleme için)
// Dönüş: ürün listesi yolu, ürün sayısı, alanlar (doluluk + örnek), önerilen eşleme, ilk ürünlerin önizlemesi
export async function POST(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  let url = String(b.url ?? "").trim();
  // Kayıtlı ek link: { id, feed_id }
  if (!url && b.id && b.feed_id) {
    const { data } = await admin().from("suppliers").select("feeds").eq("id", b.id).maybeSingle();
    url = (Array.isArray(data?.feeds) ? data!.feeds : []).find((f: any) => f.id === b.feed_id)?.url ?? "";
    if (!url) return NextResponse.json({ error: "Ek link bulunamadı" }, { status: 400 });
  }
  if (!url && b.id) {
    const { data } = await admin().from("suppliers").select("xml_url, url_from_env").eq("id", b.id).maybeSingle();
    if (data?.url_from_env && !data.xml_url) return NextResponse.json({ error: `Bu tedarikçinin adresi GitHub Secret'ta (${data.url_from_env}); panelden incelenemez. Eşleme hazır, doğrudan içe aktarabilirsin.` }, { status: 400 });
    url = data?.xml_url ?? "";
  }
  let text: string;
  try {
    // SSRF koruması: DNS çözümü + iç ağ engeli, yönlendirme her adımda doğrulanır, gövde akışla 120 MB sınırı (worker/core/safe-fetch.ts)
    const r = await safeFetch(url, { maxBytes: MAX, timeoutMs: 90000 });
    if (!r.ok) return NextResponse.json({ error: `XML indirilemedi (HTTP ${r.status})` }, { status: 400 });
    text = r.text();
  } catch (e: any) { return NextResponse.json({ error: `XML indirilemedi: ${e.message}` }, { status: 400 }); }
  if (!/^\s*(<\?xml|<)/.test(text.slice(0, 200))) return NextResponse.json({ error: "Adres XML döndürmedi (HTML sayfa veya giriş ekranı olabilir)" }, { status: 400 });

  let parsed: any;
  try { parsed = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(text); }
  catch (e: any) { return NextResponse.json({ error: `XML okunamadı: ${e.message}` }, { status: 400 }); }
  const found = findItems(parsed, b.item_path || null);
  if (!found.items.length) return NextResponse.json({ error: "XML'de ürün listesi bulunamadı. Ürün listesi yolunu elle yaz (ör. Urunler.Urun)." }, { status: 400 });
  const fields = fieldStats(found.items);
  const mapping = b.mapping && Object.keys(b.mapping).length ? b.mapping : suggestMapping(fields.map((f) => f.path));
  const sup = { code: "onizleme", mapping, sku_prefix: b.sku_prefix ?? "", sku_ascii: b.sku_ascii !== false, price_includes_vat: b.price_includes_vat !== false, default_vat: Number(b.default_vat ?? 20), default_brand: b.default_brand ?? "", currency: b.currency ?? "TRY" };
  const seen = new Set<string>();
  const groups = itemsToGroups(found.items.slice(0, 300), mapping);
  const preview = groups.slice(0, 8).map((g) => ({ row: g.rows[0].row, ...supplierPayload(g, sup, seen) }));
  return NextResponse.json({ item_path: found.path, count: found.items.length, fields, mapping, suggested: !(b.mapping && Object.keys(b.mapping).length), preview, sizeMb: Math.round(text.length / 1048576) });
}
