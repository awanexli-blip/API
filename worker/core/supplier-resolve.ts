// Tedarikçiye sipariş için çözümleyiciler (K 15.11, Bezos API). Saf fonksiyonlar, test edilir (worker/test/supplier-resolve.test.ts).
//  1) resolveVariant: sipariş satırından doğru varyant. İlan varyant barkoduyla açıldıysa doğrudan; ana ürün barkoduyla açıldıysa
//     (Trendyol 1.922 / HB 2.209 Bezos ilanı) sipariş adındaki beden/renk ("…, S/M") varyant özellikleriyle eşleştirilir. Tam olarak bir
//     varyant eşleşmezse belirsiz döner: sipariş gönderilmez, K'ya sorulur (tahmin yok).
//  2) planCarrier: sipariş kargosu ile tedarikçinin ürünü gönderebildiği kargolar. İsim farkı eşlenir ("DHL eCommerce" = "DHL").
//     Uyuşmuyorsa Trendyol'da paketin kargosunu değiştirme önerisi (PUT .../shipment-packages/{id}/cargo-providers, paket başına 5 dk'da bir).

export type VariantLite = { id?: string; barcode?: string | null; sku?: string | null; attributes?: Record<string, unknown> | null; stock?: number | null };

const fold = (s: unknown) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFC").replace(/[ıİ]/g, "i").replace(/\s+/g, " ").trim();
const tokens = (s: string) => fold(s).split(/[\s,;|()]+/).filter(Boolean);

// Sipariş adındaki seçenek kısmı: Trendyol "Ürün adı ..., S/M" (son virgülden sonrası); yoksa tüm ad
export function optionText(title: string): string {
  const t = String(title ?? "");
  const i = t.lastIndexOf(",");
  return i >= 0 ? t.slice(i + 1) : t;
}

export function resolveVariant(line: { listing_key?: string | null; title?: string | null }, variants: VariantLite[]):
  { ok: true; variant: VariantLite; by: "barkod" | "tek-varyant" | "secenek" } | { ok: false; reason: string; candidates?: string[] } {
  if (!variants.length) return { ok: false, reason: "ürünün varyantı yok" };
  const byBarcode = variants.find((v) => v.barcode && v.barcode === line.listing_key);
  if (byBarcode) return { ok: true, variant: byBarcode, by: "barkod" };
  if (variants.length === 1) return { ok: true, variant: variants[0], by: "tek-varyant" };
  // Ana ürün barkodu: seçenek metni (son virgülden sonrası) varyant özellik değerleriyle
  const opt = fold(optionText(line.title ?? ""));
  const optTok = new Set(tokens(opt));
  const valuesOf = (v: VariantLite) => Object.values(v.attributes ?? {}).map((x) => fold(x)).filter(Boolean);
  const matches = variants.filter((v) => {
    const vals = valuesOf(v);
    if (!vals.length) return false;
    // Her değer seçenek metninde geçmeli: tam ifade ("s/m", "80x150") ya da tüm kelimeleri
    return vals.every((val) => opt.includes(val) || tokens(val).every((w) => optTok.has(w)));
  });
  if (matches.length === 1) return { ok: true, variant: matches[0], by: "secenek" };
  // Yalnızca beden/ölçü yazıyorsa (renk yok): beden eşleşmesi tek ise kabul
  if (matches.length === 0) {
    const sizeKey = (v: VariantLite) => Object.entries(v.attributes ?? {}).find(([k]) => /beden|numara|ebat|boyut|ölçü|olcu|size/i.test(k))?.[1];
    const bySize = variants.filter((v) => { const s = fold(sizeKey(v)); return s && (opt.includes(s) || optTok.has(s)); });
    if (bySize.length === 1) return { ok: true, variant: bySize[0], by: "secenek" };
  }
  return { ok: false, reason: matches.length ? `seçenek birden fazla varyanta uyuyor (${matches.length})` : `seçenek ("${optionText(line.title ?? "").trim()}") hiçbir varyanta uymuyor`,
    candidates: variants.map((v) => Object.values(v.attributes ?? {}).join(" ")).slice(0, 10) };
}

// Bezos stok kodu: bizim varyant/ürün kodumuzdan tedarikçi öneki (BZS) atılır
export function supplierCode(sku: string | null | undefined, prefix: string): string {
  const s = String(sku ?? "");
  return prefix && s.toUpperCase().startsWith(prefix.toUpperCase()) ? s.slice(prefix.length) : s;
}

// Kargo: ortak anahtar
const CARRIERS: [string, RegExp][] = [
  ["aras", /aras/], ["surat", /s[uü]rat/], ["yurtici", /yurt\s*i[cç]i/], ["ptt", /ptt/], ["dhl", /dhl/],
  ["tex", /trendyol\s*express|^tex/], ["kolaygelsin", /kolay\s*gelsin|sendeo/], ["hepsijet", /hepsi\s*jet/], ["horoz", /horoz/], ["ceva", /ceva/],
];
export const carrierKey = (name: unknown) => { const n = fold(name); return CARRIERS.find(([, re]) => re.test(n))?.[0] ?? null; };
// Trendyol kargo değiştirme kodları (developers.trendyol.com v2 changeCargoProvider + kargo listesi). Kolay Gelsin: listede SENDEOMP, değiştirme sayfasında KOLAYGELSINMP (ilk kullanımda doğrulanacak)
export const TY_CARGO_CODE: Record<string, string> = { aras: "ARASMP", surat: "SURATMP", yurtici: "YKMP", ptt: "PTTMP", dhl: "DHLECOMMP", tex: "TEXMP", kolaygelsin: "SENDEOMP", horoz: "HOROZMP", ceva: "CEVAMP" };
const PREFER = ["aras", "surat", "yurtici", "ptt", "dhl", "kolaygelsin"];

export function planCarrier(orderCargo: string | null | undefined, supplierCarriers: string[], marketplace: string):
  { ok: true; carrier: string } | { ok: false; reason: string; change?: { code: string; carrier: string } } {
  const ok = supplierCarriers.map((c) => ({ c, k: carrierKey(c) })).filter((x) => x.k);
  if (!ok.length) return { ok: false, reason: "tedarikçi ürün için kargo firması bildirmiyor" };
  const k = carrierKey(orderCargo);
  const same = k ? ok.find((x) => x.k === k) : null;
  if (same) return { ok: true, carrier: same.c };
  // Uyuşmuyor: Trendyol'da paketin kargosu tedarikçinin gönderebildiği bir firmaya değiştirilebilir
  if (marketplace === "trendyol") {
    const alt = PREFER.map((p) => ok.find((x) => x.k === p)).find((x) => x && TY_CARGO_CODE[x.k!]);
    if (alt) return { ok: false, reason: `sipariş kargosu ${orderCargo ?? "?"}, ürün yalnızca ${supplierCarriers.join("/")} ile gidiyor`, change: { code: TY_CARGO_CODE[alt.k!], carrier: alt.c } };
  }
  return { ok: false, reason: `sipariş kargosu ${orderCargo ?? "?"}, ürün yalnızca ${supplierCarriers.join("/")} ile gidiyor; pazaryerinde kargo değiştirilmeli` };
}
