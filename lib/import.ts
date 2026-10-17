// CSV/Excel içe aktarma: başlık eşleme ve satırları ürün + varyantlara gruplama.
// Tarayıcıda (önizleme) ve sunucuda (API) aynı kod çalışır. Her satır = bir varyant; aynı model kodlu satırlar tek ürün.

export type Field =
  | "model" | "variant_sku" | "title" | "description" | "brand" | "category" | "vat_rate" | "desi" | "cost_price" | "currency"
  | "barcode" | "color" | "size" | "stock" | "images" | "attributes" | "status";

export const FIELD_LABEL: Record<Field, string> = {
  model: "Model kodu", variant_sku: "Varyant SKU", title: "Ürün adı", description: "Açıklama", brand: "Marka", category: "Kategori",
  vat_rate: "KDV", desi: "Desi", cost_price: "Alış fiyatı", currency: "Para birimi", barcode: "Barkod", color: "Renk", size: "Beden",
  stock: "Stok", images: "Görseller", attributes: "Özellikler", status: "Durum",
};

// Başlık eşanlamlıları (küçük harf, Türkçe harfler sadeleştirilmiş, boşluk/altçizgi yok)
const ALIASES: Record<Field, string[]> = {
  model: ["modelkodu", "model", "urunkodu", "productcode", "stokkodu", "stockcode", "anasku", "productmainid", "sku"],
  variant_sku: ["varyantsku", "variantsku", "varyantkodu", "saticistokkodu", "varyantstokkodu"],
  title: ["urunadi", "baslik", "title", "name", "urunismi", "ad", "productname"],
  description: ["aciklama", "description", "detail", "detay", "urunaciklamasi"],
  brand: ["marka", "brand"],
  category: ["kategori", "category", "kategoriadi"],
  vat_rate: ["kdv", "kdvorani", "vat", "vatrate", "tax"],
  desi: ["desi", "dimensionalweight"],
  cost_price: ["alisfiyati", "maliyet", "cost", "costprice", "fiyat", "price", "alis", "bayifiyati"],
  currency: ["parabirimi", "currency", "doviz", "kur"],
  barcode: ["barkod", "barcode", "ean", "gtin"],
  color: ["renk", "color", "colour"],
  size: ["beden", "size", "numara", "olcu"],
  stock: ["stok", "stock", "adet", "quantity", "miktar"],
  images: ["gorsel", "gorseller", "resim", "resimler", "image", "images", "foto", "fotograf", "imageurl", "gorsel1", "resim1", "image1"],
  attributes: ["ozellikler", "attributes", "ozellik"],
  status: ["durum", "status"],
};
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/[^a-z0-9]/g, "");

// Başlık -> alan. "gorsel2", "image_3" gibi numaralı sütunlar da görsel sayılır.
export function mapHeaders(headers: string[]): (Field | null)[] {
  const used = new Set<Field>();
  return headers.map((h) => {
    const n = norm(h);
    if (/^(gorsel|resim|image|foto|fotograf)\d+$/.test(n)) return "images";
    for (const [f, list] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (f !== "images" && used.has(f)) continue;
      if (list.includes(n)) { used.add(f); return f; }
    }
    return null;
  });
}

// Basit CSV ayrıştırıcı: ; , veya sekme (ilk satırdan tahmin), tırnaklı alanlar, BOM
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  const sep = counts[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type RawRow = { row: number; values: Partial<Record<Field, string>>; images: string[] };

// Tablo -> satır nesneleri (row = dosyadaki satır numarası, başlık 1. satır)
export function toRawRows(table: string[][], fields: (Field | null)[]): RawRow[] {
  return table.slice(1).map((cells, i) => {
    const values: Partial<Record<Field, string>> = {};
    const images: string[] = [];
    fields.forEach((f, j) => {
      const v = String(cells[j] ?? "").trim();
      if (!f || v === "") return;
      if (f === "images") images.push(...v.split(/[\s|,;]+/).filter((u) => /^https?:\/\//i.test(u)));
      else values[f] = v;
    });
    return { row: i + 2, values, images };
  }).filter((r) => Object.keys(r.values).length || r.images.length);
}

export type Group = { model: string; rows: RawRow[] };

// Aynı model kodlu satırlar tek ürün. Model kodu yoksa varyant SKU, o da yoksa satır kendi başına bir ürün (SKU sonra üretilir).
export function groupRows(rows: RawRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = (r.values.model || r.values.variant_sku || `#${r.row}`).trim();
    const g = map.get(key.toLowerCase()) ?? { model: key, rows: [] };
    g.rows.push(r);
    map.set(key.toLowerCase(), g);
  }
  return [...map.values()];
}

const num = (v?: string) => (v == null || v === "" ? undefined : v.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
const VAT_MAP: Record<string, string> = { "0": "0", "1": "1", "8": "10", "10": "10", "18": "20", "20": "20" };
const STATUS_MAP: Record<string, string> = { aktif: "active", active: "active", taslak: "draft", draft: "draft", pasif: "draft", arsiv: "archived", archived: "archived" };
const CUR_MAP: Record<string, string> = { tl: "TRY", try: "TRY", "₺": "TRY", usd: "USD", "$": "USD", eur: "EUR", "€": "EUR" };

// "Malzeme: Bambu; Menşei: TR" -> { Malzeme: "Bambu", Menşei: "TR" }
const attrs = (s?: string) => Object.fromEntries((s ?? "").split(/[;\n|]/).map((x) => x.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(":").trim()]));

// Grup -> kısmi ürün yükü: yalnızca dosyada olan alanlar (olmayanlar mevcut üründe korunur)
export function groupToPayload(g: Group) {
  const pick = (f: Field) => g.rows.map((r) => r.values[f]).find((v) => v != null && v !== "");
  const p: Record<string, any> = {};
  if (!g.model.startsWith("#")) p.sku = g.model;
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== "") p[k] = v; };
  set("title", pick("title"));
  set("description", pick("description"));
  set("brand", pick("brand"));
  set("category", pick("category"));
  const vat = pick("vat_rate"); if (vat) p.vat_rate = VAT_MAP[vat.replace(/[%\s]/g, "")] ?? vat;
  set("desi", num(pick("desi")));
  set("cost_price", num(pick("cost_price")));
  const cur = pick("currency"); if (cur) p.currency = CUR_MAP[cur.toLowerCase()] ?? cur.toUpperCase();
  const st = pick("status"); if (st) p.status = STATUS_MAP[norm(st)] ?? st;
  const a = attrs(pick("attributes")); if (Object.keys(a).length) p.attributes = a;
  const imgs = [...new Set(g.rows.flatMap((r) => r.images))].map((u) => u.replace(/^http:\/\//i, "https://"));
  if (imgs.length) p.images = imgs.slice(0, 20);
  p.variants = g.rows.map((r) => {
    const v: Record<string, any> = {};
    const vs = r.values.variant_sku || (g.rows.length === 1 ? r.values.model : undefined);
    if (vs) v.sku = vs;
    if (r.values.barcode) v.barcode = r.values.barcode.replace(/\s/g, "");
    const va: Record<string, string> = {};
    if (r.values.color) va.Renk = r.values.color;
    if (r.values.size) va.Beden = r.values.size;
    if (Object.keys(va).length) v.attributes = va;
    if (r.values.stock != null) v.stock = String(Math.max(0, Math.floor(Number(num(r.values.stock)) || 0)));
    return v;
  });
  return p;
}

// Hata yolu ("variants.1.barcode") -> dosya satırı
export function errorRow(g: Group, path: string): number {
  const m = path.match(/^variants\.(\d+)/);
  return m ? g.rows[Number(m[1])]?.row ?? g.rows[0].row : g.rows[0].row;
}

// Şablon (Excel'de açılır: ; ayraç, BOM)
export const TEMPLATE_HEADERS = ["Model kodu", "Ürün adı", "Açıklama", "Marka", "Kategori", "Alış fiyatı", "Para birimi", "KDV", "Desi", "Stok", "Barkod", "Renk", "Beden", "Varyant SKU", "Görsel1", "Görsel2", "Görsel3", "Özellikler", "Durum"];
export const TEMPLATE_EXAMPLE = [
  ["KESME-01", "Bambu Kesme Tahtası 3'lü Set", "Doğal bambu, 3 farklı boy.", "Eco Lounge", "Mutfak", "149,90", "TRY", "20", "2", "25", "", "", "", "", "https://ornek.com/1.jpg", "", "", "Malzeme: Bambu; Menşei: Türkiye", "Aktif"],
  ["TSHIRT-01", "Basic Pamuklu Tişört", "%100 pamuk.", "Eco Lounge", "Giyim", "120", "TRY", "10", "1", "10", "", "Siyah", "M", "TSHIRT-01-SYH-M", "https://ornek.com/t1.jpg", "", "", "", "Aktif"],
  ["TSHIRT-01", "", "", "", "", "", "", "", "", "8", "", "Siyah", "L", "TSHIRT-01-SYH-L", "", "", "", "", ""],
];
