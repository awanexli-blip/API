// Marka riski: başlığında / açıklamasında korunan bir marka ya da lisanslı karakter geçen ürün pazaryerine gönderilmez
// (Trendyol "Marka hakkı ihlali" / "Hatalı marka" uyarıları birikirse mağazayı kapatabilir). Liste: `brand_blocklist` (panel → Markalar).

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
  const { data, error } = await db.from("brand_blocklist").select("word");
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
