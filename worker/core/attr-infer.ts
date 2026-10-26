// Zorunlu özelliği ürün metninden çıkarma (başlık + açıklama). Saf fonksiyon, test edilir (attr-infer.test.ts).
// Sıra: evet/hayır özellikleri (anahtar kelime) > sayı + birim / aralık (mm, mAh, W, Hz, L) > metinde geçen değer adı > özellik adına göre tercih listesi.
// Kullanıcı kararları (22.10): garanti seçeneği "yok" olmayan kategoride İthalatçı Garantili + 2 Yıl; Menşei TR (tedarikçi varsayılanı).

export type AttrValue = { id: number; name: string };

const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
// Karşılaştırma biçimi: küçük harf, noktalama boşluk, "47 mm" -> "47mm", "7,5" -> "7.5"
const norm = (s: string) => " " + lo(s).replace(/(\d),(\d)/g, "$1.$2").replace(/[^0-9a-zçğıöşü.+]+/g, " ").replace(/(\d)\s+(mm|cm|mah|w|watt|hz|v|l|ml|gb|tb|inç|inch|yaş|lü|li|lı|lu)\b/g, "$1$2").replace(/\s+/g, " ").trim() + " ";
const has = (text: string, phrase: string) => text.includes(norm(phrase).trimEnd()); // sonu açık: Türkçe ekler (bebek -> bebekler)
const pick = (vals: AttrValue[], names: string[]) => names.map((n) => vals.find((v) => lo(v.name).trim() === lo(n))).find(Boolean) ?? null;

// Ürün/varyant kaydındaki özellik değeri (defaults) pazaryeri özellik adıyla: önce birebir ad, sonra eş anlamlı grup
// (panelde "Beden: 42" girilen ayakkabı Trendyol/HB'de "Numara"/"Ayakkabı Numarası"/"numara_variant_property" olabilir; renk de "Web Color" vb.)
const ATTR_GROUPS: [string, RegExp][] = [["beden", /beden|numara|size|ölçü|olcu/], ["renk", /renk|colou?r/]];
const groupOf = (name: string) => ATTR_GROUPS.find(([, re]) => re.test(lo(name)))?.[0] ?? null;
export function defaultFor(defaults: Record<string, string> | undefined, ...names: (string | number | undefined)[]): string | undefined {
  const entries = Object.entries(defaults ?? {}).filter(([, v]) => v != null && String(v).trim() !== "");
  const keys = names.filter((n) => n != null).map((n) => lo(String(n)));
  const exact = entries.find(([k]) => keys.includes(lo(k)));
  if (exact) return exact[1];
  const g = keys.map(groupOf).find(Boolean);
  return g ? entries.find(([k]) => groupOf(k) === g)?.[1] : undefined;
}

// Var/Yok, Evet/Hayır özellikleri: hangi kelimeler "var" demek
const YESNO: [RegExp, string[]][] = [
  [/mikrofon/, ["mikrofon", "mikrofonlu", "mic"]],
  [/gürültü|anc/, ["anc", "aktif gürültü", "gürültü önleme", "gürültü engelleme", "noise cancel"]],
  [/suya|su geçir|tere/, ["suya dayanıklı", "su geçirmez", "ipx4", "ipx5", "ipx6", "ipx7", "ip67", "ip68", "waterproof", "tere dayanıklı", "su sıçramasına"]],
  [/çoklu bağlantı/, ["çoklu bağlantı", "çift cihaz", "multipoint", "aynı anda 2"]],
  [/pil ile/, ["pilli", "pil ile", "pille çalışır", "pil dahil", "aa pil", "aaa pil", "kalem pil", "düğme pil"]],
  [/otomatik kapanma/, ["otomatik kapanma", "oto kapanma", "otomatik kapanır"]],
  [/dijital ekran|lcd ekran|^ekran/, ["dijital", "lcd", "led ekran", "ekranlı", "göstergeli"]],
  [/uygulama/, ["uygulama", "app ", "akıllı telefon ile"]],
  [/wi-?fi/, ["wifi", "wi fi", "kablosuz ağ"]],
  [/dim/, ["dimmer", "dim özellik", "ışık ayarlı", "kademeli ışık"]],
  [/şarj/, ["şarjlı", "şarj edilebilir", "usb şarj"]],
];

// Özellik adına göre tercih (değer listesinde ilk bulunan seçilir)
function preferred(name: string, text: string): string[] {
  const n = lo(name);
  if (/^dil$/.test(n)) return ["Türkçe", "Evrensel Dil"];
  if (/yaş grubu/.test(n)) return has(text, "bebek") ? ["Bebek", "Çocuk"] : has(text, "yetişkin") ? ["Yetişkin", "Unisex"] : ["Çocuk", "Unisex", "Yetişkin"];
  if (/^yaş$/.test(n)) {
    const m = /(\d{1,2})\s*(?:\+|yaş)/.exec(text);
    return m ? [`${m[1]} Yaş`, `${m[1]}+ Yaş`, `${m[1]} Yaş +`, "Tüm Yaşlar"] : ["Tüm Yaşlar", "3 Yaş", "3+ Yaş"];
  }
  if (/frekans/.test(n)) return ["50 Hz", "50/60 Hz", "60 Hz / 50 Hz", "50-60 Hz"];
  if (/voltaj|gerilim/.test(n)) return ["220 V", "220-240 V", "230 V", "220V", "220 - 240 V", "220-240V"];
  if (/kutu durumu/.test(n)) return /kutu/.test(text) ? ["Kutulu", "Kutu var"] : ["Kutu yok", "Kutusuz"];
  if (/garanti tipi/.test(n)) return ["İthalatçı Garantili", "Distribütör Garantili", "Resmi Distribütör Garantili"];
  if (/garanti süresi/.test(n)) return ["2 Yıl", "24 Ay", "1 Yıl", "12 Ay"];
  if (/paket içeriği|adet/.test(n)) {
    const m = /(\d{1,3})\s*(?:adet|'?l[iıuü]\b|parça)/.exec(text);
    const c = m ? Number(m[1]) : 1;
    return c <= 1 ? ["Tekli", "1 Adet", "1'li", "1"] : [`${c}'li`, `${c}'lı`, `${c}'lu`, `${c}'lü`, `${c} Adet`, `${c}`];
  }
  if (/çalışma tipi|güç kaynağı/.test(n)) {
    if (/solar|güneş enerji/.test(text)) return ["Solar", "Güneş Enerjili"];
    if (/şarj|usb/.test(text)) return ["Şarjlı", "Şarj Edilebilir", "USB", "Adaptörlü"];
    if (/pil/.test(text)) return ["Pilli", "Pil"];
    if (/fiş|elektrik|220/.test(text)) return ["Elektrikli", "Adaptörlü", "Kablolu"];
    return [];
  }
  if (/^model$/.test(n)) {
    if (/şarj|usb/.test(text)) return ["Kablosuz -Şarj Edilebilir", "Kablosuz - Şarj Edilebilir", "Şarjlı"];
    if (/pil/.test(text)) return ["Kablosuz-Pilli", "Kablosuz - Pilli", "Pilli"];
    if (/kablo|fiş|priz/.test(text)) return ["Kablolu"];
    return [];
  }
  if (/mevsim/.test(n)) return ["4 Mevsim", "Yaz", "3 Mevsim"];
  // Hepsiburada listesi çoğu kategoride yalnızca Erkek / Kadın / Erkek Çocuk / Kız Çocuk (Unisex yok): cinsiyet metinde açıkça geçmiyorsa
  // keyfi seçilmez (Unisex yoksa boş kalır, panel → Özellik tamamla)
  if (/cinsiyet/.test(n)) {
    if (/ kız(lar|ım|ınız)? | kız çocu| girl/.test(text)) return ["Kız Çocuk", "Kız Bebek", "Kadın", "Unisex"];
    if (/ erkek çocu| oğlan| boy /.test(text)) return ["Erkek Çocuk", "Erkek Bebek", "Erkek", "Unisex"];
    if (/ kadın| bayan| women/.test(text)) return ["Kadın", "Unisex"];
    if (/ erkek| men /.test(text)) return ["Erkek", "Unisex"];
    return ["Unisex"];
  }
  return [];
}

// Sayı + birim (değer listesi "47 mm", "20000 ve üzeri", "11500 - 20000", "0,5 L" gibi)
function numeric(name: string, vals: AttrValue[], text: string): AttrValue | null {
  const n = lo(name);
  const unit = /mah/.test(n) ? "mah" : /watt|\(w\)|güç/.test(n) ? "w" : /çap|mm/.test(n) ? "mm" : /hacim|kapasite/.test(n) ? "l" : /hafıza|depolama/.test(n) ? "gb" : /ekran boyut|inç/.test(n) ? "inç" : null;
  if (!unit) return null;
  const nums: number[] = [];
  const re = unit === "l" ? /(\d+(?:\.\d+)?)(ml|l)\b/g : new RegExp(`(\\d+(?:\\.\\d+)?)(${unit === "w" ? "w|watt" : unit})\\b`, "g");
  for (const m of text.matchAll(re)) nums.push(unit === "l" && m[2] === "ml" ? Number(m[1]) / 1000 : Number(m[1]));
  if (!nums.length) return null;
  const x = Math.max(...nums);
  const parsed = vals.map((v) => {
    const s = lo(v.name).replace(/,/g, ".");
    const r = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(s);
    if (r) return { v, lo: Number(r[1]), hi: Number(r[2]) };
    const up = /(\d+(?:\.\d+)?)\s*(?:ve üzeri|ve üstü|\+)/.exec(s);
    if (up) return { v, lo: Number(up[1]), hi: Infinity };
    const below = /(\d+(?:\.\d+)?)\s*\S*\s*altı/.exec(s);
    if (below) return { v, lo: 0, hi: Number(below[1]) };
    const one = /^(\d+(?:\.\d+)?)/.exec(s.trim());
    return one ? { v, lo: Number(one[1]), hi: Number(one[1]) } : null;
  }).filter((p): p is { v: AttrValue; lo: number; hi: number } => !!p);
  const exact = parsed.find((p) => p.lo === x && p.hi === x);
  if (exact) return exact.v;
  const inRange = parsed.filter((p) => p.lo !== p.hi && x >= p.lo && x <= p.hi).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))[0];
  if (inRange) return inRange.v;
  const near = parsed.filter((p) => p.lo === p.hi && Math.abs(p.lo - x) <= x * 0.1).sort((a, b) => Math.abs(a.lo - x) - Math.abs(b.lo - x))[0];
  return near?.v ?? null;
}

export function inferAttribute(name: string, vals: AttrValue[], title: string, description = ""): AttrValue | null {
  if (!vals.length) return null;
  const t = norm(title), all = norm(`${title} ${description.slice(0, 3000)}`);
  const n = lo(name);
  // 1) Var/Yok, Evet/Hayır
  const names = new Set(vals.map((v) => lo(v.name).trim()));
  const yesNo = names.has("var") && names.has("yok") ? ["Var", "Yok"] : names.has("evet") && names.has("hayır") ? ["Evet", "Hayır"] : null;
  if (yesNo && vals.length <= 3) {
    const kw = YESNO.find(([re]) => re.test(n))?.[1] ?? n.replace(/\(.*?\)|\?|mı|mi|var mı/g, " ").split(/\s+/).filter((w) => w.length > 3);
    const yes = kw.some((k) => has(all, k));
    return pick(vals, [yes ? yesNo[0] : yesNo[1]]);
  }
  // 2) Sayı + birim
  const num = numeric(name, vals, all);
  if (num) return num;
  // 3) Değer adı metinde geçiyor (önce başlık, sonra açıklama; en uzun eşleşme). Çok kısa ve genel değerler hariç.
  const generic = /^(var|yok|evet|hayır|diğer|standart|yok değil|belirtilmemiş)$/;
  const usable = vals.filter((v) => { const s = lo(v.name).trim(); return s.length >= 3 && !generic.test(s) && !/^\d+$/.test(s); });
  for (const text of [t, all]) {
    const hit = usable.filter((v) => text.includes(norm(v.name))).sort((a, b) => b.name.length - a.name.length)[0];
    if (hit) return hit;
  }
  // 4) Özellik adına göre tercih listesi
  return pick(vals, preferred(name, all));
}

// Serbest metne izin veren özellikte (değer listesi yok/uymuyor) metinden yazılabilecek değer
export function inferCustom(name: string, title: string, description = ""): string | null {
  const n = lo(name), all = norm(`${title} ${description.slice(0, 3000)}`);
  if (/paket içeriği/.test(n)) { const m = /(\d{1,3})\s*(?:adet|parça)/.exec(all); return `${m ? Number(m[1]) : 1} Adet`; }
  if (/garanti süresi/.test(n)) return "2 Yıl";
  if (/garanti tipi/.test(n)) return "İthalatçı Garantili";
  if (/frekans/.test(n)) return "50 Hz";
  if (/voltaj|gerilim/.test(n)) return "220 V";
  return null;
}
