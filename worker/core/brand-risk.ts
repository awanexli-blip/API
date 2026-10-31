// Marka riski: başlığında / açıklamasında korunan bir marka ya da lisanslı karakter geçen ürün pazaryerine gönderilmez
// (Trendyol "Marka hakkı ihlali" / "Hatalı marka" uyarıları birikirse mağazayı kapatabilir). Liste: `brand_blocklist` (panel → Markalar).
import { readAll } from "./util.ts";

export const norm = (s: string) => ` ${String(s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/g, " ").trim()} `;

// Kelime sınırına göre eşleşir: "lg" yalnızca tek başına geçerse, "hello kitty" ifade olarak
export function brandMatcher(words: string[]) {
  const list = [...new Set(words.map((w) => norm(w).trim()).filter((w) => w.length >= 2))];
  return (title: string, description = ""): string | null => {
    const t = norm(title), d = norm(description);
    for (const w of list) if (t.includes(` ${w} `) || d.includes(` ${w} `)) return w;
    return null;
  };
}

export async function loadBrandMatcher(db: any) {
  const { data, error } = await readAll((a: number, b: number) => db.from("brand_blocklist").select("word").order("word").range(a, b));
  // Tablo yoksa ya da boşsa ilk liste: filtresiz gönderim hiç yapılmaz
  const words = error ? [] : (data ?? []).map((r: any) => r.word).filter(Boolean);
  return brandMatcher(words.length ? words : DEFAULT_BLOCKLIST);
}

// İlk liste (migration 023 ile tabloya da yazılır): telefon/elektronik, beyaz eşya, moda, oyuncak ve lisanslı karakterler, otomobil, kulüp
export const DEFAULT_BLOCKLIST = [
  "apple", "iphone", "ipad", "airpods", "macbook", "magsafe", "airtag", "lightning", "samsung", "galaxy", "xiaomi", "redmi", "huawei", "honor", "oppo", "realme", "oneplus", "nokia",
  "sony", "playstation", "ps4", "ps5", "xbox", "nintendo", "lg", "philips", "bosch", "siemens", "arçelik", "arcelik", "beko", "vestel", "tefal", "arzum", "fakir", "sinbo", "karaca",
  "korkmaz", "emsan", "paşabahçe", "pasabahce", "tupperware", "dyson", "braun", "remington", "rowenta", "babyliss", "gillette", "jbl", "marshall", "bose", "beats", "logitech", "razer",
  "steelseries", "hyperx", "corsair", "anker", "baseus", "ugreen", "hoco", "ttec", "lenovo", "asus", "acer", "dell", "msi", "canon", "nikon", "gopro", "dji", "garmin", "casio", "rolex",
  "seiko", "swatch", "fossil", "tissot", "swarovski", "pandora", "nike", "adidas", "puma", "reebok", "converse", "vans", "skechers", "lacoste", "levis", "zara", "disney", "marvel",
  "avengers", "spiderman", "spider man", "batman", "superman", "frozen", "elsa", "mickey", "minnie", "barbie", "lego", "hasbro", "mattel", "hot wheels", "fisher price", "pokemon", "pikachu",
  "hello kitty", "sanrio", "kuromi", "paw patrol", "peppa", "sonic", "minecraft", "roblox", "fortnite", "harry potter", "star wars", "stitch", "labubu", "squishmallows", "funko", "nerf",
  "playmobil", "chicco", "avent", "pampers", "huggies", "loreal", "maybelline", "nivea", "dior", "chanel", "gucci", "prada", "versace", "armani", "hermes", "louis vuitton", "michael kors",
  "rayban", "ray ban", "oakley", "stanley", "thermos", "starbucks", "coca cola", "red bull", "redbull", "mercedes", "bmw", "audi", "volkswagen", "toyota", "ferrari", "porsche", "tesla",
  "lamborghini", "fenerbahçe", "galatasaray", "beşiktaş", "trabzonspor", "fifa", "nba", "uefa", "staedtler", "parker", "stabilo", "crayola", "moleskine", "duracell", "energizer",
  "victorinox", "zippo", "smeg", "kitchenaid", "nespresso", "delonghi", "tchibo", "lavazza", "ikea", "ally", "duzzona", "uslion", "wiwu", "joyroom", "remax", "borofone", "spigen", "otterbox",
];

// Uyumluluk ifadesi markasız yazılır (K, 31.10: "iOS uyumlu yerine tüm telefonlarla uyumlu"). YALNIZCA doğru olan dönüşümler:
//   "Android ve iOS Uyumlu" / "iOS Android Windows Uyumlu" / "İos-Android" -> "Akıllı Telefon Uyumlu" (ürün iki sistemle de çalışıyor)
//   "Android TV (Box)" -> "Akıllı TV (Box)"
// Tek başına "Android Uyumlu" / "iPhone kılıfı" / "Android 7.1" dönüştürülmez (yalnızca o sistemle çalışan ürün; "tüm telefonlar" yanlış olur):
// marka listesindeki "android" / "ios" ile gönderilmez.
// Büyük harf başlıkta noktalı İ ("ANDROİD") ve noktasız ı da kabul (i bayrağı Türkçe İ/ı'yı katlamaz)
const OS = String.raw`(?:[iİIı]\s?os|andro[iİIı]d)`;
const SEP = String.raw`\s*(?:ve|ile|&|\/|-|,|\+)?\s*`;
const PAIR = new RegExp(String.raw`(?<![\p{L}\d])${OS}(?:${SEP}(?:${OS}|windows|mac\s?os))+(?:\s+ile)?(?:\s+tüm\s+telefonlara)?(?:\s+(uyumlu|destekli|ile\s+uyumlu))?(?![\p{L}\d])`, "giu");
const ATV = /(?<![\p{L}\d])andro[iİIı]d(\s+)(tv)(?![\p{L}\d])/giu;
export function neutralizeCompat(text: string | null | undefined): string {
  let s = String(text ?? "");
  if (!s) return s;
  s = s.replace(PAIR, (m: string, suffix?: string) => {
    // Hem iOS hem Android geçmeli (ör. "Android, Windows" dönüşmez)
    if (!/[iİIı]\s?os/iu.test(m) || !/andro[iİIı]d/iu.test(m)) return m;
    const up = m === m.toLocaleUpperCase("tr");
    const out = suffix ? `Akıllı Telefon ${/destekli/i.test(suffix) ? "Destekli" : "Uyumlu"}` : "Akıllı Telefon";
    return up ? out.toLocaleUpperCase("tr") : out;
  });
  return s.replace(ATV, (_m, sp: string, tv: string) => `Akıllı${sp}${tv === "tv" ? "tv" : tv.toUpperCase() === tv ? "TV" : "Tv"}`);
}
