// Trendyol güvenli liste (K 22.11): eski mağaza 21.11'de "hatalı barkod oranı -> orijinallik şüphesi" (48 puan) ve 11.11'de
// "kötü niyetli hatalı kategori" (12 puan) ile süresiz kapandı. Ölçüm (22.11): yayındaki 37.068 ilanın 28.274'ü (%76) GTIN değil
// (BZ.., HS.., TCXBY.., CLZ..), Bezos/Çerçici'nin gerçek GTIN'li ürünleri ise "Eco Lounge / Genel Markalar / Tcx" markasıyla açılmıştı
// (barkodun sahibi marka ile ilan markası tutmuyor = "Hatalı Marka"). Yeni mağazaya bu kurallardan geçmeyen hiçbir ürün gönderilmez.
//
// İki katman: tyHardBlock (Trendyol adaptörünün createProducts'ında son kapı, her yol için) + tySafeCheck (gönderim kuyruğunda
// ayrıntılı neden; panelde "gönderilemeyen" olarak görünür). Saf modül (ağ yok), testleri worker/test/ty-safe.test.ts.

// GS1 üye ülke önekleri (EAN-13 ilk 3 hane; UPC-12 başına 0 eklenerek). Aralık dışı = hiçbir GS1 ülkesine ait değil.
// 27.11: Bezos'ta "NW NessiWorld" / "BEZOS" markalı 12.700 ürünün barkodu sağlama hanesi doğru ama RASTGELE üretilmiş
// (583, 196, 161... önekleri; her barkod farklı firma kodu). Sağlama hanesi tek başına yetmez.
const GS1_RANGES: [number, number][] = [
  [0, 139], [300, 379], [380, 380], [383, 383], [385, 385], [387, 387], [389, 389], [400, 440], [450, 459], [460, 469], [470, 471], [474, 479], [480, 489], [490, 499],
  [500, 509], [520, 521], [528, 531], [535, 535], [539, 539], [540, 549], [560, 560], [569, 569], [570, 579], [590, 590], [594, 594], [599, 599],
  [600, 601], [603, 604], [608, 609], [611, 611], [613, 613], [615, 616], [618, 619], [620, 631], [640, 649], [690, 699],
  [700, 709], [729, 729], [730, 739], [740, 746], [750, 750], [754, 755], [759, 759], [760, 769], [770, 771], [773, 773], [775, 775], [777, 780], [784, 786], [789, 790],
  [800, 839], [840, 849], [850, 850], [858, 860], [865, 865], [867, 869], [870, 880], [884, 885], [888, 888], [890, 890], [893, 893], [896, 896], [899, 899],
  [900, 919], [930, 939], [940, 949], [950, 951], [955, 955], [958, 958], [960, 969], [977, 979],
];
/** 13 haneye çevrilmiş GTIN (UPC-12 -> 0 + kod, GTIN-14 -> gösterge hanesi atılır); EAN-8 için null. */
const gtin13 = (c: string) => (c.length === 13 ? c : c.length === 12 ? "0" + c : c.length === 14 ? c.slice(1) : null);
export function gs1Assigned(code: string): boolean {
  const c13 = gtin13(code);
  if (!c13) return true; // EAN-8: ayrı önek tablosu, sağlama ile yetinilir
  const p = Number(c13.slice(0, 3));
  return GS1_RANGES.some(([a, b]) => p >= a && p <= b);
}
/** Firma kodu yaklaşığı (ilk 7 hane): gerçek firma barkodları ortak önek taşır, rastgele barkodlar taşımaz. */
export const gtinPrefix = (code: string) => gtin13(String(code ?? "").trim())?.slice(0, 7) ?? null;

/** GTIN-8/12/13/14 sağlama haneli + GS1 ülke aralığında; mağaza içi (2 ile başlayan EAN-13) ve sıfırlar geçersiz. */
export function isTyGtin(code: string | null | undefined): boolean {
  const c = String(code ?? "").trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(c) || /^0+$/.test(c)) return false;
  if (c.length === 13 && c.startsWith("2")) return false; // GS1: mağaza içi / değişken ağırlık
  const d = c.split("").map(Number), check = d.pop()!;
  const sum = d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check && gs1Assigned(c);
}

const fold = (s: string) => String(s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
export const brandKey = (s: string) => fold(s);

/** Başkasının ürününe takılamayacak markalar: bizim mağaza markalarımız, tedarikçi adları ve "markasız" yer tutucuları. */
export const PLACEHOLDER_BRANDS = [
  "eco lounge", "ecolounge", "genel markalar", "genel marka", "genel", "tcx", "hepsibayi", "colezium", "çerçici", "cercici", "bezos", "toptancım", "toptancim",
  "bayilikxml", "bayilikxml.com", "nw nessiworld", "nessiworld", "akıllı bayi", "akilli bayi", // 27.11: NessiWorld/BEZOS Bezos'ta başka firmaların ürünlerine takılı (Tigger peluş vb.)
  "markasız", "markasiz", "marka yok", "diğer", "diger", "other", "generic", "oem", "no brand", "nobrand", "noname", "no name", "belirtilmemiş", "yok", "-",
];
export function placeholderBrand(brand: string | null | undefined, extra: string[] = []): boolean {
  const b = fold(brand ?? "");
  if (!b) return true;
  return [...PLACEHOLDER_BRANDS, ...extra.map(fold)].includes(b);
}

// +18 / cinsel sağlık / fantezi: Trendyol'da ayrı filtre ister; yanlış kategoride "kötü niyetli hatalı kategori" (12 puan). Yeni mağazada hiç açılmaz.
const ADULT = /(\+\s?18|cinsel|erotik|fantezi|fantazi|seks|sex|vibrat|penis|vajina|genital|anal\s?bakım|analbakım|prezervatif|kondom|geciktirici|ereksiyon|kayganlaştırıcı|lubricant|jartiyer|kaz gagası|afrodizyak|libido|stimulan)/u;
// Sağlık beyanı (4/12 puan), ilaç/takviye, tıbbi cihaz, kozmetik bildirim gerektirenler: belge olmadan açılmaz.
const HEALTH = /(tedavi eder|tedavi edici|iyileştirir|şifa|zayıflat|kilo verdir|yağ yakıcı|ağrı kesici|hastalığ|kanser|diyabet|tansiyon düşür|bağışıklığı güçlendir|ilaç|takviye|vitamin|probiyotik|gıda takviyesi|tıbbi cihaz|medikal|serum fizyolojik|kolajen|kreatin|protein tozu)/u;
// Trendyol satış kuralı + yasal kısıt (lib/scope.ts TY_RULE'a ek): tütün ürünleri, silah, elektronik sigara, alkol, gıda
const BANNED = /(?<![\p{L}])(çakmak|çakmağı|küllük|kül tablası|sigara|e-sigara|elektronik sigara|vape|tütün|nargile|puro|tabanca|tüfek|silah|mermi|şarjör|kasatura|muşta|sustalı|biber gazı|şok cihazı|alkol|bira|şarap|viski|rakı)(?![\p{L}])/u;
// Lisanslı karakter / tanınmış marka sözcükleri (marka ihlali, belge ister). Ürünün KENDİ markası bunlardan biriyse ayrıca yetki listesine bakılır.
const LICENSED = /(disney|marvel|pixar|frozen|elsa|mickey|minnie|spider[\s-]?man|örümcek adam|batman|superman|avengers|harry potter|hello kitty|barbie|pokemon|pokémon|star wars|darth vader|minecraft|roblox|fortnite|paw patrol|peppa|sonic|stitch|garfield|tweety|looney|ninja kaplumbağa|transformers|hot wheels|lego|hasbro|mattel|fisher[\s-]?price|nerf|play[\s-]?doh|monopoly|my little pony|transformers|pj masks|l\.o\.l|bluey|cocomelon|polly pocket|beyblade|baby born|pokemon|uno kart|jenga|porsche|ferrari|lamborghini|bugatti|mclaren|bmw|mercedes|audi|volkswagen|honda|yamaha|kawasaki|ducati|dodge|ford mustang|chevrolet|toyota|nissan|jeep|land rover|range rover|tesla|byd|cadillac|rolls[\s-]?royce|bentley|maserati|lotus|koenigsegg|harley|loz|panlos|cada|mould king|sembo|wange|lepin|nike|adidas|puma|gucci|louis vuitton|chanel|rolex|ray[\s-]?ban|apple|iphone orijinal|airpods|playstation|nintendo)/u;
// "X uyumlu" / "X için" uyumluluk ifadesi marka iddiası değildir (Samsung uyumlu batarya): eşleşme öncesi çıkarılır
const COMPAT = /([\p{L}\d+\s-]{2,40})\s(uyumlu|için|ile uyumlu)\b/gu;

/** Trendyol'un resmi "markası yok" markası (canlı 27.11: brands/by-name "Markası Yok" -> id 3024252). Yalnızca doğrulanmış markasız ürün. */
export const TY_NOBRAND = "Ürünümün Markası Yok";
/** Markasız ürünlerde kendi iç barkodumuz: ASCII, tekil, makul uzunluk */
const OWN_CODE = /^[A-Z0-9][A-Z0-9._-]{5,39}$/;

export type TySafeInput = {
  title: string; description?: string | null; brand?: string | null; category?: string | null; mpCategory?: string | null;
  barcodes: string[]; images?: string[]; stock?: number;
  /** İki görsel model fotoğraf/ambalaj/başlık/açıklamada marka görmedi (worker/vision-attrs.ts -> "Markasız doğrulandı"=evet) */
  verifiedNoBrand?: boolean;
};
export type TySafeCtx = {
  /** Katalogda birden çok ürüne ait barkodlar (çoklama riski) */
  dupBarcodes?: Set<string>;
  /** Katalogda en az 3 üründe geçen firma kodları (gtinPrefix). Verilirse önek bu kümede olmayan barkod "rastgele üretilmiş" sayılır. */
  knownPrefixes?: Set<string>;
  /** K'nın belgeyle onayladığı markalar: verilirse (boş da olsa) yalnızca bunlar açılır; undefined = marka listesi denetimi kapalı */
  allowedBrands?: Set<string>;
  /** Tedarikçi adı vb. ek yer tutucular */
  extraPlaceholders?: string[];
  /** Kategori kaynağı: elle / onaylı eşleme = güvenli; tahmin = yalnızca öneri */
  categorySource?: "manual" | "map" | "predicted" | "none";
  /** "strict" (varsayılan): yalnızca elle/eşleme; "high": yüksek güvenli tahmin de olur */
  categoryMode?: "strict" | "high";
  predictedHigh?: boolean;
  minStock?: number;
};

/** Son kapı (adaptör): barkod GTIN, marka gerçek, +18/yasak değil. Neden ya da null. */
export function tyHardBlock(p: { id: string; brand?: string | null; title?: string | null; category?: string | null }, extraPlaceholders: string[] = []): string | null {
  const nobrand = String(p.brand ?? "").trim() === TY_NOBRAND;
  if (nobrand) { if (!OWN_CODE.test(String(p.id ?? ""))) return `Güvenli liste: markasız üründe barkod biçimi uygun değil (${p.id})`; }
  else if (!isTyGtin(p.id)) return `Güvenli liste: barkod gerçek GTIN değil (${p.id}); iç kodla ilan açılmaz`;
  if (!nobrand && placeholderBrand(p.brand, extraPlaceholders)) return `Güvenli liste: marka "${p.brand ?? ""}" ürünün gerçek markası değil (mağaza/tedarikçi adı ya da boş)`;
  const t = fold(`${p.title ?? ""} ${p.category ?? ""}`);
  const a = t.match(ADULT); if (a) return `Güvenli liste: +18 / cinsel sağlık ürünü ("${a[1]}")`;
  const b = t.match(BANNED); if (b) return `Güvenli liste: yasak ürün ("${b[1]}")`;
  return null;
}

/** Ayrıntılı denetim: tüm nedenler (boş dizi = gönderilebilir). */
export function tySafeCheck(p: TySafeInput, ctx: TySafeCtx = {}): string[] {
  const out: string[] = [];
  const codes = p.barcodes.map((b) => String(b ?? "").trim());
  const nb = !!p.verifiedNoBrand;
  if (nb) {
    // Markasız (K 27.11): iç barkod kabul, ama tekil ve düzgün biçimli; başlıkta "uyumlu" (başka markaya gönderme) olmaz
    if (!codes.length || codes.some((b) => !OWN_CODE.test(b))) out.push("barkod: markasız üründe barkod biçimi uygun değil");
    if (/(uyumlu|için uyumlu|ile uyumlu)/i.test(fold(p.title))) out.push("markasız: başlıkta 'uyumlu' (başka markaya gönderme) var");
  } else if (!codes.length || codes.some((b) => !isTyGtin(b))) out.push("barkod: gerçek GTIN değil (iç kod / sağlama hanesi hatalı / boş)");
  if (!nb && ctx.knownPrefixes && codes.length && codes.every(isTyGtin)) {
    const lone = codes.filter((b) => { const p = gtinPrefix(b); return p != null && !ctx.knownPrefixes!.has(p); });
    if (lone.length) out.push(`barkod: firma kodu katalogda tek (${lone[0]}) – rastgele üretilmiş barkod şüphesi, gerçek üretici barkodu değil`);
  }
  const dup = codes.filter((b) => ctx.dupBarcodes?.has(b));
  if (dup.length) out.push(`barkod: katalogda başka ürünle aynı (${dup.slice(0, 2).join(", ")}) – çoklama riski`);
  if (nb) { /* marka TY_NOBRAND olarak gönderilir; onay listesi gerekmez */ }
  else if (placeholderBrand(p.brand, ctx.extraPlaceholders)) out.push(`marka: "${p.brand ?? ""}" gerçek üretici markası değil`);
  else if (ctx.allowedBrands && !ctx.allowedBrands.has(fold(p.brand!))) out.push(`marka: "${p.brand}" onaylı markalar listesinde yok (fatura/yetki belgesiyle onayla)`);
  const text = fold(`${p.title} ${p.category ?? ""} ${p.mpCategory ?? ""}`);
  const full = fold(`${p.title} ${p.description ?? ""}`);
  const a = text.match(ADULT) ?? full.match(ADULT); if (a) out.push(`kategori: +18 / cinsel sağlık ("${a[1]}")`);
  const b = text.match(BANNED); if (b) out.push(`yasak ürün: "${b[1]}"`);
  const h = full.match(HEALTH); if (h) out.push(`sağlık beyanı / ilaç-takviye: "${h[1]}"`);
  const lic = fold(p.title).replace(COMPAT, " ").match(LICENSED);
  const licAny = lic ?? fold(`${p.description ?? ""}`).replace(COMPAT, " ").match(LICENSED); // korumalı marka açıklamada da geçmemeli
  if (licAny && (nb || !(p.brand && fold(p.brand).includes(licAny[1]) && ctx.allowedBrands?.has(fold(p.brand))))) out.push(`marka/lisans riski: "${licAny[1]}"`);
  const src = ctx.categorySource ?? "none";
  const catOk = src === "manual" || src === "map" || (src === "predicted" && ctx.categoryMode === "high" && ctx.predictedHigh);
  if (!catOk) out.push(src === "predicted" ? "kategori: yalnızca tahmin (elle seç ya da kategori eşlemesini onayla)" : "kategori: seçilmemiş");
  if (!(p.images ?? []).some((u) => /^https?:\/\//.test(String(u)))) out.push("görsel yok");
  if (ctx.minStock != null && Number(p.stock ?? 0) < ctx.minStock) out.push(`stok: tedarikçide ${Number(p.stock ?? 0)} (< ${ctx.minStock}, iptal riski)`);
  return out;
}

/** app_state "ty_safe": yoksa AÇIK (güvenli varsayılan). */
export type TySafeCfg = { enabled: boolean; categoryMode: "strict" | "high"; minStock: number; brandAllowlist: boolean };
export function parseTySafe(v: unknown): TySafeCfg {
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = null; } }
  o = o && typeof o === "object" ? o : {};
  const ms = Number(o.minStock);
  return { enabled: o.enabled !== false, categoryMode: o.categoryMode === "high" ? "high" : "strict", minStock: Number.isFinite(ms) && ms >= 0 ? ms : 5, brandAllowlist: o.brandAllowlist !== false };
}
