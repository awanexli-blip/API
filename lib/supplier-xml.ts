// Tedarikçi XML'i -> ürün yükü. Panel (inceleme/önizleme) ve worker (içe aktarma) aynı kodu kullanır.
// Akış: ürün listesini bul -> her ürünü düz alanlara aç -> eşlemeye göre CSV satırı gibi -> grupla (aynı model = varyant) -> yük.
// Node testleri uzantılı import ister; tsconfig allowImportingTsExtensions açık.
import { groupRows, groupToPayload, mapHeaders, type Field, type Group, type RawRow } from "./import.ts";

export type Supplier = {
  code: string; mapping: Record<string, Field>; item_path?: string | null; sku_prefix?: string; sku_ascii?: boolean;
  price_includes_vat?: boolean; default_vat?: number; default_brand?: string; currency?: string;
};

// Aynı tedarikçinin ek XML linki (suppliers.feeds, migration 048). Boş alanlar ana linkin ayarını kullanır.
export type Feed = { id: string; label?: string; url?: string; sku_prefix?: string | null; mapping?: Record<string, Field> | null; item_path?: string | null };
export function feedSupplier<T extends Supplier>(sup: T, feed?: Feed | null): T {
  if (!feed) return sup;
  return { ...sup, sku_prefix: feed.sku_prefix ?? sup.sku_prefix, mapping: feed.mapping && Object.keys(feed.mapping).length ? feed.mapping : sup.mapping, item_path: feed.item_path || sup.item_path };
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
      if (items.slice(0, 3000).some((it) => { const v = at(it, pre); return Array.isArray(v) && v.some(isObj); })) { out.add(pre); break; }
    }
  }
  return [...out];
}
// Varyant elemanındaki ad/değer çiftleri (name1=Renk, value1=Kırmızı; name2=Beden, value2=M) -> renk / beden
function pairValues(el: any): { color?: string; size?: string } {
  const out: { color?: string; size?: string } = {};
  for (const k of Object.keys(el ?? {})) {
    const m = /^(name|ad|isim)(\d*)$/i.exec(k);
    if (!m) continue;
    const name = String(el[k] ?? "").trim(), val = String(el[`value${m[2]}`] ?? el[`deger${m[2]}`] ?? "").trim();
    if (!name || !val) continue;
    if (/renk|colou?r/i.test(name)) out.color ??= val;
    else out.size ??= /^(beden|numara|size)$/i.test(name) ? val : `${name} ${val}`;
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
      // Önce varyant yolları, sonra ürün yolları (aynı alana ikisi de eşlenmişse varyantınki geçerli)
      const entries = Object.entries(mapping).sort(([a], [b]) => Number(!!cont && b.startsWith(cont + ".")) - Number(!!cont && a.startsWith(cont + ".")));
      for (const [path, field] of entries) {
        const v = flat[path];
        if (v == null) continue;
        if (field === "images") images.push(...(Array.isArray(v) ? v : v.split(/[\s|,;]+/)).filter((u) => /^https?:\/\//i.test(u)));
        else if (values[field] == null) values[field] = Array.isArray(v) ? v[0] : v;
      }
      if (el) { const pv = pairValues(el); if (pv.color && values.color == null) values.color = pv.color; if (pv.size && values.size == null) values.size = pv.size; }
      rows.push({ row: i + 1, values, images });
    }
  });
  return groupRows(rows.filter((r) => Object.keys(r.values).length));
}

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
  p.title = String(p.title).replace(/\s+/g, " ").trim().slice(0, 300);
  if (p.description) p.description = String(p.description).slice(0, 30000);
  if (p.category) p.category = String(p.category).slice(0, 200);
  if (sup.default_brand) p.brand = sup.default_brand; // tedarikçi markası pazaryerinde yoksa sabit marka
  if (p.brand) p.brand = String(p.brand).slice(0, 100);
  p.vat_rate = [0, 1, 10, 20].includes(Number(p.vat_rate)) ? Number(p.vat_rate) : sup.default_vat ?? 20;
  if (!["TRY", "USD", "EUR"].includes(p.currency)) p.currency = sup.currency ?? "TRY";
  const cost = Number(p.cost_price);
  p.cost_price = cost > 0 ? Math.round((sup.price_includes_vat === false ? cost * (1 + p.vat_rate / 100) : cost) * 100) / 100 : null;
  const desi = Number(p.desi); p.desi = desi > 0 ? desi : null;
  p.status = p.status === "draft" ? "draft" : "active"; // XML pasif işaretliyse taslak (ör. active=0)
  p.source_ref = String(g.model).slice(0, 200);
  const used = new Set<string>();
  p.variants = p.variants.map((v: any, i: number) => {
    let sku = v.sku ? cleanSku(v.sku, sup) : p.variants.length === 1 ? p.sku : `${p.sku}-${i + 1}`;
    if (!SKU_RE.test(sku) || used.has(sku.toLowerCase())) sku = `${p.sku}-${i + 1}`.slice(0, 64);
    used.add(sku.toLowerCase());
    const out: any = { sku, stock: Math.max(0, Math.min(1_000_000, Math.floor(Number(v.stock) || 0))) };
    const b = String(v.barcode ?? "").replace(/\s/g, "");
    if (b && CODE_RE.test(b) && gtinOk(b) && !seenBarcodes.has(b.toLowerCase())) { out.barcode = b; seenBarcodes.add(b.toLowerCase()); }
    if (v.attributes) out.attributes = v.attributes;
    return out;
  });
  return { payload: p };
}
