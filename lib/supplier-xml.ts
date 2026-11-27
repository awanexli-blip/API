// Tedarikçi XML'i -> ürün yükü. Panel (inceleme/önizleme) ve worker (içe aktarma) aynı kodu kullanır.
// Akış: ürün listesini bul -> her ürünü düz alanlara aç -> eşlemeye göre CSV satırı gibi -> grupla (aynı model = varyant) -> yük.
// Node testleri uzantılı import ister; tsconfig allowImportingTsExtensions açık.
import { groupRows, groupToPayload, mapHeaders, type Field, type Group, type RawRow } from "./import.ts";
import type { ApiSource } from "./supplier-api.ts";

export type Supplier = {
  code: string; mapping: Record<string, Field>; item_path?: string | null; sku_prefix?: string; sku_ascii?: boolean;
  price_includes_vat?: boolean; default_vat?: number; default_brand?: string; currency?: string;
  cost_add?: number | null; // ürün başına ek maliyet, KDV dahil TL (Çerçici +9,90 hizmet/paketleme; migration 083)
};
const addCost = (sup: Supplier, c: number) => Math.round((c + (Number(sup.cost_add) > 0 ? Number(sup.cost_add) : 0)) * 100) / 100;

// Aynı tedarikçinin ek XML linki (suppliers.feeds, migration 048). Boş alanlar ana linkin ayarını kullanır.
// type "api": REST API (lib/supplier-api.ts, ayar api alanında); yoksa XML
// K 17.11 (Bezos API): price_includes_vat link bazında (Bezos XML KDV hariç, API KDV dahil); skip_known: önceki linklerde olan barkodlu ürün atlanır
// (aynı ürün iki linkten iki ayrı ürün olarak açılmasın); transform "bezos": varyant ailesi ve "Hizmetler" atlanır (varyantlar XML'den gelir).
export type Feed = { id: string; label?: string; url?: string; sku_prefix?: string | null; mapping?: Record<string, Field> | null; item_path?: string | null; type?: "xml" | "api"; api?: ApiSource | null;
  price_includes_vat?: boolean | null; skip_known?: boolean; transform?: "bezos" | null };
export function feedSupplier<T extends Supplier>(sup: T, feed?: Feed | null): T {
  if (!feed) return sup;
  return { ...sup, sku_prefix: feed.sku_prefix ?? sup.sku_prefix, mapping: feed.mapping && Object.keys(feed.mapping).length ? feed.mapping : sup.mapping, item_path: feed.item_path || sup.item_path,
    ...(feed.price_includes_vat != null ? { price_includes_vat: feed.price_includes_vat } : {}) };
}

// Bezos API ürün listesi süzgeci: tek ürünler (varyant ailesi değil), hizmet olmayan, ve skip_known ise önceki linklerde barkodu görülmemiş olanlar
export function feedFilter(items: any[], feed: Feed, seen: Set<string>): { items: any[]; skipped: number } {
  let out = items;
  if (feed.transform === "bezos") {
    const parents = new Set(items.map((x) => x?.variantParentId).filter((x) => x != null).map(String));
    out = out.filter((x) => x && x.variantParentId == null && !parents.has(String(x.id)) && !/^hizmetler/i.test(String(x.categoryPath ?? "").trim()));
  }
  if (feed.skip_known) out = out.filter((x) => { const b = String(x?.barcode ?? "").replace(/\s/g, "").toLowerCase(); return !b || !seen.has(b); });
  return { items: out, skipped: items.length - out.length };
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

// Ürün listesi: verilen yol ya da en büyük nesne dizisi
export function findItems(parsed: any, itemPath?: string | null): { path: string; items: any[] } {
  if (itemPath) {
    let cur = parsed;
    for (const k of itemPath.split(".")) cur = cur?.[k];
    const arr = Array.isArray(cur) ? cur : isObj(cur) ? [cur] : [];
    return { path: itemPath, items: arr.filter(isObj) };
  }
  let best = { path: "", items: [] as any[] };
  const walk = (o: any, path: string, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(o)) {
      const objs = o.filter(isObj);
      if (objs.length > best.items.length) best = { path, items: objs };
      return;
    }
    if (isObj(o)) for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(parsed, "", 0);
  // Tek ürünlü XML: liste değil nesne
  if (!best.items.length && isObj(parsed)) {
    const leafHost = (o: any, path: string): { path: string; items: any[] } | null => {
      for (const [k, v] of Object.entries(o)) if (isObj(v)) return Object.values(v).some((x) => !isObj(x) && !Array.isArray(x)) ? { path: path ? `${path}.${k}` : k, items: [v] } : leafHost(v, path ? `${path}.${k}` : k);
      return null;
    };
    return leafHost(parsed, "") ?? best;
  }
  return best;
}

// Ürünü düz alanlara aç: { "images.image": ["u1","u2"], "price": "12" } (en fazla 3 seviye)
export function flatten(o: any, prefix = "", out: Record<string, string | string[]> = {}, depth = 0): Record<string, string | string[]> {
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      const prim = v.filter((x) => !isObj(x) && !Array.isArray(x)).map(String).filter(Boolean);
      if (prim.length) out[key] = prim;
      else if (depth < 2) v.filter(isObj).slice(0, 1).forEach((x) => flatten(x, key, out, depth + 1)); // nesne dizisinde ilk eleman (ör. tek kategori)
    } else if (isObj(v)) {
      if (depth < 3) flatten(v, key, out, depth + 1);
    } else out[key] = String(v).trim();
  }
  return out;
}

// İnceleme: alan yolları, doluluk ve örnek değerler
export function fieldStats(items: any[], sample = 500) {
  const stats = new Map<string, { n: number; samples: string[] }>();
  const part = items.slice(0, sample);
  for (const it of part) for (const [k, v] of Object.entries(flatten(it))) {
    const s = stats.get(k) ?? { n: 0, samples: [] };
    s.n++;
    const val = Array.isArray(v) ? v.join(" | ") : v;
    if (s.samples.length < 3 && val && !s.samples.includes(val)) s.samples.push(val.slice(0, 120));
    stats.set(k, s);
  }
  return [...stats].map(([path, s]) => ({ path, fill: Math.round((s.n / Math.max(1, part.length)) * 100), samples: s.samples }));
}

// Önerilen eşleme: alan adının son parçası eşanlamlılarla karşılaştırılır (CSV başlık eşlemesiyle aynı)
export function suggestMapping(paths: string[]): Record<string, Field> {
  const last = paths.map((p) => p.split(".").slice(-1)[0]);
  const fields = mapHeaders(last);
  const out: Record<string, Field> = {};
  paths.forEach((p, i) => { if (fields[i]) out[p] = fields[i]!; });
  // Aynı alana birden çok yol düştüyse (görseller hariç) ilki kalır
  return out;
}

// Yoldaki değer (a.b.c)
const at = (o: any, path: string) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
// İç içe varyant listesi ("variants.variant" gibi nesne dizisi): eşlemede bu yolun altındaki alan varsa her eleman ayrı satır olur
function variantContainers(items: any[], mapping: Record<string, Field>): string[] {
  const out = new Set<string>();
  for (const key of Object.keys(mapping)) {
    const segs = key.split(".");
    for (let n = segs.length - 1; n >= 1; n--) {
      const pre = segs.slice(0, n).join(".");
      // Tüm ürünlere bakılır (06.11: Bezos'ta seçenekli ürünler ilk 3.000'den sonra başlıyordu, varyantlar hiç görülmüyordu)
      if (items.some((it) => { const v = at(it, pre); return Array.isArray(v) && v.some(isObj); })) { out.add(pre); break; }
    }
  }
  return [...out];
}
// Bezos varyantı (K, 06.11): <var_deger isim="EBAT">80X80</var_deger> özniteliği ayrıştırıcıda kaybolur -> <name1>EBAT</name1><value1>80X80</value1> (pairValues).
// Seçeneğin barkodu yok: kendi kodundan <var_barkod> üretilir (BZ önekli, K: Bezos barkodu BZ ile başlar; sabit, her okumada aynı).
export function flattenVarDeger(xml: string): string {
  if (!xml.includes("<var_deger")) return xml;
  return xml.replace(/<varyasyon>[\s\S]*?<\/varyasyon>/g, (blk) => {
    let i = 0;
    const out = blk.replace(/<var_deger\s+isim="([^"]*)"\s*>([\s\S]*?)<\/var_deger>/g, (_m, n, v) => { i++; return `<name${i}>${n}</name${i}><value${i}>${v}</value${i}>`; });
    const kod = /<kod>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/kod>/.exec(blk)?.[1]?.replace(/[^A-Za-z0-9._-]/g, "");
    return kod ? out.replace("</varyasyon>", `<var_barkod>${/^BZ/i.test(kod) ? kod : `BZ${kod}`}</var_barkod></varyasyon>`) : out;
  });
}

// Google Merchant RSS (Falez, K 28.11): <g:id>, <g:mpn>, <g:price>599.00 TRY</g:price>, çoklu <g:additional_image_link>, <g:product_detail> (bölüm/ad/değer).
// Düz ürüne çevrilir: id, mpn, title, description, image (çok), price (sayı, KDV dahil), stock (availability in_stock -> sabit FALEZ_STOCK; yok -> 0), brand, type, color, desi,
// attributes ("Materyal: Suntalam; Renk: Efes; ..." -> import.ts attrs). Stok alanı yok: gerçek stok bilinmez, in_stock için güvenli sabit.
export const FALEZ_STOCK = 10;
const unesc = (x: string) => x.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" } as Record<string, string>)[e]);
const esc2 = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function flattenGoogleFeed(xml: string): string {
  if (!xml.includes("<g:id>")) return xml;
  const tag = (blk: string, t: string) => blk.match(new RegExp(`<g:${t}>([\\s\\S]*?)</g:${t}>`))?.[1]?.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim() ?? "";
  const all = (blk: string, t: string) => [...blk.matchAll(new RegExp(`<g:${t}>([\\s\\S]*?)</g:${t}>`, "g"))].map((m) => m[1].trim()).filter(Boolean);
  // ":" ";" "|" ve satır sonu özellik ayracıdır: değerden temizlenir
  const clean = (x: string) => unesc(x).replace(/[:;|\r\n]+/g, ",").replace(/\s+/g, " ").trim();
  return xml.replace(/<item>[\s\S]*?<\/item>/g, (blk) => {
    const price = Number((tag(blk, "price").match(/[\d.,]+/)?.[0] ?? "").replace(/,/g, "")) || 0;
    const det = new Map<string, string>();
    for (const m of blk.matchAll(/<g:product_detail>([\s\S]*?)<\/g:product_detail>/g)) { const n = clean(tag(m[1], "attribute_name")), v = clean(tag(m[1], "attribute_value")); if (n && v && !det.has(n)) det.set(n, v); }
    const color = clean(tag(blk, "color"));
    const at: [string, string][] = [];
    for (const k of ["Materyal", "Şekil", "Tema / Stil", "Parça Sayısı", "Menşei", "Garanti Süresi"]) if (det.get(k)) at.push([k, det.get(k)!]);
    if (color) at.splice(1, 0, ["Renk", color]);
    const imgs = [...all(blk, "image_link"), ...all(blk, "additional_image_link")];
    const stock = /^in[_ ]?stock$/i.test(tag(blk, "availability")) ? FALEZ_STOCK : 0;
    return `<item><id>${tag(blk, "id")}</id><mpn>${tag(blk, "mpn")}</mpn><title>${tag(blk, "title")}</title><description>${tag(blk, "description")}</description>${imgs.map((u) => `<image>${u}</image>`).join("")}`
      + `<price>${price}</price><stock>${stock}</stock><brand>${tag(blk, "brand")}</brand><type>${tag(blk, "product_type")}</type><color>${esc2(color)}</color><desi>${det.get("Desi") ?? ""}</desi>`
      + `<attributes>${esc2(at.map(([k, v]) => `${k}: ${v}`).join("; "))}</attributes></item>`;
  });
}

// Varyant elemanındaki ad/değer çiftleri (name1=Renk, value1=Kırmızı; name2=Beden, value2=M) -> renk / beden
function pairValues(el: any): { color?: string; size?: string } {
  const out: { color?: string; size?: string } = {};
  for (const k of Object.keys(el ?? {})) {
    // Colezium (16.11): VariantName1/VariantValue1 (sıra ürüne göre değişir: 1. özellik Renk de Beden de olabilir)
    const m = /^(?:variant)?(name|ad|isim)(\d*)$/i.exec(k);
    if (!m) continue;
    const name = String(el[k] ?? "").trim(), val = String(el[`value${m[2]}`] ?? el[`VariantValue${m[2]}`] ?? el[`deger${m[2]}`] ?? "").trim();
    if (!name || !val) continue;
    if (/renk|colou?r/i.test(name)) out.color ??= val;
    // SEÇENEK / EBAT değeri tek başına anlamlı ("Krem", "80X80"); "SEÇENEK Krem" yazılmaz
    else out.size ??= /^(beden|numara|size|ebat|seçenek|secenek)$/i.test(name) ? val : `${name} ${val}`;
  }
  return out;
}

// XML ürünleri -> gruplar (her ürün = bir satır; aynı model kodu = varyant). İç içe varyant listesi varsa her varyant bir satır:
// varyantın alanları (stok, barkod) ürün düzeyindekinin önüne geçer.
export function itemsToGroups(items: any[], mapping: Record<string, Field>): Group[] {
  const containers = variantContainers(items, mapping);
  const rows: RawRow[] = [];
  items.forEach((it, i) => {
    const cont = containers.find((c) => at(it, c) != null);
    const raw = cont ? at(it, cont) : null;
    const els: any[] = cont ? (Array.isArray(raw) ? raw : [raw]).filter(isObj) : [null];
    const base = flatten(it);
    for (const el of els.length ? els : [null]) {
      const flat: Record<string, string | string[]> = { ...base };
      if (el && cont) { for (const k of Object.keys(flat)) if (k.startsWith(cont + ".")) delete flat[k]; Object.assign(flat, flatten(el, cont)); }
      const values: Partial<Record<Field, string>> = {};
      const images: string[] = [];
      const catParts: [string, string][] = [];
      // Önce varyant yolları, sonra ürün yolları (aynı alana ikisi de eşlenmişse varyantınki geçerli)
      // Tek seçenekli ürün (Bezos: 8 bin model) gerçek varyant değil: model kodu ve barkodu kalır, satıştaki ilan kopmaz; stok/fiyat seçenekten gelir
      const one = els.length === 1 && !!el;
      const entries = Object.entries(mapping).filter(([path, field]) => !(one && (field === "variant_sku" || path.endsWith(".var_barkod")))).sort(([a], [b]) => Number(!!cont && b.startsWith(cont + ".")) - Number(!!cont && a.startsWith(cont + ".")));
      for (const [path, field] of entries) {
        const v = flat[path];
        if (v == null) continue;
        // "Hata:" içeren adres tedarikçinin indiremediği görsel (Hepsibayi dokümanı: ".../Hata: Görsel indirilemedi."): atlanır
        if (field === "images") { const list = Array.isArray(v) ? v : /Hata:/i.test(v) ? [] : v.split(/[\s|,;]+/); images.push(...list.filter((u) => /^https?:\/\//i.test(u) && !/Hata:/i.test(u))); }
        else if (field === "category") catParts.push([path, String(Array.isArray(v) ? v[0] : v).trim()]);
        else if (values[field] == null) values[field] = Array.isArray(v) ? v[0] : v;
      }
      // Birden çok yol kategoriye eşlenmişse (xmloyuncak: mainCategory/category/subCategory) ana > ara > alt sırasıyla " > " ile birleşir; tek yolda eskisi gibi
      if (catParts.length) {
        const rank = (p: string) => (/(^|\.)(main|ana)/i.test(p) ? 0 : /(^|\.)(sub|alt)/i.test(p) ? 2 : 1);
        const parts = catParts.sort((a, b) => rank(a[0]) - rank(b[0])).map((x) => x[1]).filter(Boolean);
        values.category = catParts.length === 1 ? parts[0] : parts.filter((x, i) => x !== parts[i - 1]).join(" > ");
      }
      if (el) { const pv = pairValues(el); if (pv.color && values.color == null) values.color = pv.color; if (pv.size && values.size == null) values.size = pv.size; }
      // Renk yerine tutucu değer (Hepsibayi tek varyantlı üründe "RZ", 80 varyant): renk sayılmaz, pazaryerine "RZ" rengi gitmez
      if (values.color != null && /^(rz|-|yok)$/i.test(values.color.trim())) delete values.color;
      rows.push({ row: i + 1, values, images });
    }
  });
  return groupRows(rows.filter((r) => Object.keys(r.values).length));
}

// Tek başına anlamsız ek/parça sözcük: "Çuk" (Çocuk), "sı/si" (Şapkası, Maması), "lı/lü", "Bı" (Bandı)
export const brokenTitle = (t: string) => /(^|\s)(sı|si|su|sü|Bı|lü|lı|lu|li|Çuk|ı|i)(\s|$)/u.test(String(t ?? ""));

export const BEZOS_MOBILYA_NOTE = "Mobilya ürünü: Mobilya ürünleri siparişin verildiği gün atölyeye aktarılır ve ertesi iş günü kargoya verilir.";
const SKU_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{2,64}$/;
const CODE_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/;
const ascii = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "");
const cleanSku = (s: string, sup: Supplier) => {
  const base = sup.sku_ascii !== false ? ascii(s) : s.replace(/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]/g, "");
  return ((sup.sku_prefix ?? "") + base).slice(0, 64);
};
const gtinOk = (b: string) => !/^\d+$/.test(b) || [8, 12, 13, 14].includes(b.length);

// Grup -> içe aktarma yükü (veya hata). Barkodu geçersiz/tekrarlı olan varyantta barkod boş bırakılır (yeni üründe sonra üretilir).
export function supplierPayload(g: Group, sup: Supplier, seenBarcodes: Set<string>): { payload?: any; error?: string } {
  const p: any = groupToPayload(g);
  if (!p.sku) return { error: "ürün kodu (model) yok" };
  p.sku = cleanSku(p.sku, sup);
  if (!SKU_RE.test(p.sku)) return { error: `geçersiz ürün kodu: ${g.model}` };
  if (!p.title || String(p.title).trim().length < 2) return { error: "ürün adı yok" };
  // XML'de çift kaçışlı kalan HTML karakterleri (Colezium 17.11: "Oyun &amp; Oyuncak")
  const unent = (x: unknown) => String(x ?? "").replace(/&(amp|lt|gt|quot|#39|apos);/g, (_m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" } as Record<string, string>)[e]);
  p.title = unent(p.title);
  if (p.category) p.category = unent(p.category);
  // Sondaki depo/tedarikçi kodu atılır: "... HDMI KABLO (4767)", "... Kalemlik-(5775)" (yalnızca parantez içinde 3-6 rakam, başlık sonunda)
  p.title = String(p.title).replace(/\s+/g, " ").trim().replace(/\s*-?\s*\(\d{3,6}\)$/, "").trim().slice(0, 300);
  if (p.description) p.description = String(p.description).slice(0, 30000);
  if (p.category) p.category = String(p.category).slice(0, 200);
  // Bezos mobilya (K, 06.11): teslimat notu; açıklamanın sonuna, kesilmeyecek şekilde
  if (sup.code === "bezos" && /(^|>)\s*mobilya\s*(>|$)/iu.test(String(p.category ?? ""))) p.description = `${String(p.description ?? "").slice(0, 29800)}\n\n${BEZOS_MOBILYA_NOTE}`.trim();
  if (sup.default_brand) p.brand = sup.default_brand; // tedarikçi markası pazaryerinde yoksa sabit marka
  if (p.brand) p.brand = String(p.brand).slice(0, 100);
  p.vat_rate = [0, 1, 10, 20].includes(Number(p.vat_rate)) ? Number(p.vat_rate) : sup.default_vat ?? 20;
  if (!["TRY", "USD", "EUR"].includes(p.currency)) p.currency = sup.currency ?? "TRY";
  const cost = Number(p.cost_price);
  p.cost_price = cost > 0 ? addCost(sup, sup.price_includes_vat === false ? cost * (1 + p.vat_rate / 100) : cost) : null;
  const desi = Number(p.desi); p.desi = desi > 0 ? desi : null;
  p.status = p.status === "draft" ? "draft" : "active"; // XML pasif işaretliyse taslak (ör. active=0)
  // Colezium (16.11): ~1.700 başlıkta sözcük parçaları silinmiş ("Kız Çuk Giyim", "Kedi sı"); bozuk başlık satışa çıkmasın diye taslak
  if (sup.code === "colezium" && brokenTitle(p.title)) p.status = "draft";
  p.source_ref = String(g.model).slice(0, 200);
  const used = new Set<string>();
  p.variants = p.variants.map((v: any, i: number) => {
    let sku = v.sku ? cleanSku(v.sku, sup) : p.variants.length === 1 ? p.sku : `${p.sku}-${i + 1}`;
    if (!SKU_RE.test(sku) || used.has(sku.toLowerCase())) sku = `${p.sku}-${i + 1}`.slice(0, 64);
    used.add(sku.toLowerCase());
    const out: any = { sku, stock: Math.max(0, Math.min(1_000_000, Math.floor(Number(v.stock) || 0))) };
    // Seçeneğin kendi fiyatı (Bezos: halı 80x80 975 TL, 300x400 11.283 TL): üründekinden farklıysa varyanta yazılır, fiyat motoru onu kullanır
    const vc = Number(String(g.rows[i]?.values.cost_price ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (vc > 0) { const c = addCost(sup, sup.price_includes_vat === false ? vc * (1 + p.vat_rate / 100) : vc); if (c !== p.cost_price) out.cost_price = c; }
    const b = String(v.barcode ?? "").replace(/\s/g, "");
    if (b && CODE_RE.test(b) && gtinOk(b) && !seenBarcodes.has(b.toLowerCase())) { out.barcode = b; seenBarcodes.add(b.toLowerCase()); }
    if (v.attributes) out.attributes = v.attributes;
    return out;
  });
  return { payload: p };
}
