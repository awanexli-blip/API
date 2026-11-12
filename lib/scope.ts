// Satış kısıtı (K, 01.11 düzeltme: "sadece gıda ve iç giyim ürünlerini satamıyoruz"; 31.10'daki izinli-liste yorumu yanlıştı). Saf; worker kullanır, testli.
// Yasak: gıda/içecek (su, kola, makarna, çikolata, bebek maması ...) ve iç giyim (külot, boxer, sütyen, atlet, çorap, body/zıbın, pijama ...).
// Gıda DEĞİL: kahve makinesi, çay fincanı, mama kabı, gıda saklama kabı (alet/kap). Evcil hayvan maması yasak sayılmaz (insan gıdası değil).
// Girdi: pazaryeri kategori adı ve/veya tedarikçi kategori yolu ("A > B > C"); kategori yoksa başlık (yalnızca kesin iç giyim kelimeleri).
// Açma/kapama: app_state "scope_filter" = "on" (açık) / başka (kapalı). Açıkken yasak ilanın stoğu 0, yeni gönderim yapılmaz.

export type ScopeGroup = "genel";
export type ScopeResult = { ok: boolean; group?: ScopeGroup; reason?: string };

// Kategori adının (ya da yol parçasının) TAMAMI bunlardan biriyse yasak
const FOOD_EXACT = new Set(["su", "kola", "makarna", "pirinç", "bakliyat", "zeytinyağı", "sıvı yağ", "çikolata", "sağlıklı atıştırmalık", "atıştırmalık", "bebek bisküvisi",
  "kavanoz maması", "bebek maması", "devam sütü", "şeker hamuru", "kahve", "türk kahvesi", "filtre kahve", "çay", "bitki çayı", "bal", "reçel", "baharat", "kuruyemiş", "cips", "bisküvi",
  "gofret", "kek", "şeker", "şekerleme", "sakız", "lokum", "un", "süt", "peynir", "yoğurt", "tereyağı", "et", "tavuk", "konserve", "salça", "sos", "ketçap", "mayonez", "tuz", "sirke",
  "mercimek", "nohut", "bulgur", "yulaf", "kahvaltılık gevrek", "granola", "protein tozu", "gıda takviyesi", "vitamin", "enerji içeceği", "maden suyu", "meyve suyu", "gazlı içecek",
  "soğuk çay", "hazır çorba", "pekmez", "tahin", "helva", "zeytin", "turşu", "dondurma", "sporcu besini"]);
const UNDER_EXACT = new Set(["külot", "boxer", "sütyen", "atlet", "çorap", "emzirme sütyeni", "emzirme atleti", "bebek body & zıbın", "body", "zıbın", "fanila", "slip", "string",
  "jartiyer", "korse", "korse & büstiyer", "büstiyer", "bralet", "babydoll", "gecelik", "pijama", "pijama takımı", "sabahlık", "kombinezon", "jüpon", "içlik", "termal içlik", "termal giyim",
  "külotlu çorap", "soket çorap", "patik çorap", "iç çamaşırı takımı", "lohusa sabahlık", "erkek iç giyim", "kadın iç giyim"]);
// Yol parçasının TAMAMI gıda başlığıysa yasak (02.11: "Süpermarket, Pet Shop > Sağlık > Masaj Aleti" ve "Yiyecek & İçecek Hazırlama > Su Isıtıcı"
// gıda DEĞİL; parça içinde arama bunları eliyordu). İç giyim için parça içinde arama güvenli ("Giyim > İç Giyim > ...").
const FOOD_PART = /^(temel gıda|gıda|gıda ürünleri|kuru gıda|dondurulmuş gıda|organik gıda|yiyecek|yiyecekler|içecek|içecekler|atıştırmalık|atıştırmalıklar|takviye edici gıda|takviye edici gıdalar|gıda takviyeleri|kahvaltılık|kahvaltılıklar|şarküteri|et & tavuk|et, tavuk & balık|meyve & sebze|bebek maması|mama ve beslenme ürünleri)$/u;
const UNDER_PART = /(iç giyim|iç çamaşır|ic giyim|ic camasir)/u;
// 04.11: Bezos kategorileri Türkçe karaktersiz ("Temel Gida", "Icecekler", "Gıda ve İçecek Ürünleri"): karşılaştırma harfleri düzleştirerek yapılır
const fold = (x: string) => x.replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o");
const FOOD_EXACT_F = new Set([...FOOD_EXACT].map(fold));
const FOOD_PART_F = new RegExp(fold(FOOD_PART.source).replace("^(", "^(gida ve icecek urunleri|gida ve icecek|gida urunleri ve icecekler|"), "u");
// Kategori yoksa başlıkta kesin iç giyim kelimesi
const UNDER_TITLE = /(?<![\p{L}])(külot|boxer|sütyen|iç çamaşır|çorap(?!lık)|atlet(?!ik)|fanila|jartiyer|babydoll|bralet|büstiyer)(?![\p{L}])/u;

function forbiddenCat(cat: string): string | null {
  for (const raw of cat.split(">")) {
    const s = raw.trim();
    if (!s) continue;
    if (FOOD_EXACT.has(s) || FOOD_EXACT_F.has(fold(s))) return `gıda (${s})`;
    if (UNDER_EXACT.has(s)) return `iç giyim (${s})`;
    if (UNDER_PART.test(s)) return `iç giyim (${s})`;
    if (FOOD_PART.test(s) || FOOD_PART_F.test(fold(s))) return `gıda (${s})`;
  }
  return null;
}

export function inScope(x: { cat?: string | null; title?: string | null }): ScopeResult {
  // Türkçe küçük harf: "İç Giyim" (i bayrağı İ/ı'yı katlamaz)
  const cat = String(x.cat ?? "").toLocaleLowerCase("tr"), title = String(x.title ?? "").toLocaleLowerCase("tr");
  if (cat.trim()) {
    const f = forbiddenCat(cat);
    return f ? { ok: false, reason: `satılamaz: ${f}` } : { ok: true, group: "genel" };
  }
  const m = title.match(UNDER_TITLE);
  return m ? { ok: false, reason: `satılamaz: iç giyim (${m[1]})` } : { ok: true, group: "genel" };
}

// Tedarikçinin KDV oranı %1 / %0 (04.11): Türkiye'de %1 KDV neredeyse yalnızca temel gıda (çay, pirinç, yağ, helva...); %0 da şüpheli
// (ör. sofra takımı %0 yazılmış: oran yanlış -> fatura yanlış kesilir). İkisi de satılmaz, tedarikçiyle doğrulanmalı.
export function vatSuspect(vat: unknown): string | null {
  const v = vat == null || vat === "" ? null : Number(vat);
  return v === 1 ? "tedarikçi KDV %1 (temel gıda olabilir)" : v === 0 ? "tedarikçi KDV %0 (oran şüpheli: tedarikçiyle doğrula)" : null;
}

export const SCOPE_LABEL: Record<ScopeGroup, string> = { genel: "Satılabilir (gıda ve iç giyim dışı)" };

// Birden çok kategori kaynağı (tedarikçi yolu, pazaryeri kategorisi): biri yasaksa yasak (güvenli taraf). Kategori yoksa başlık.
export function inScopeAny(cats: (string | null | undefined)[], title?: string | null): ScopeResult {
  const list = cats.filter((c): c is string => !!c && !!c.trim());
  if (!list.length) return inScope({ title });
  for (const c of list) { const r = inScope({ cat: c, title }); if (!r.ok) return r; }
  return { ok: true, group: "genel" };
}

// Yeni gönderim: mevcut ilanla aynı kural (pazaryeri ya da tedarikçi kategorisi yasaksa gönderilmez)
export function inScopeForSend(supplierCat: string | null | undefined, mpCat: string | null | undefined, title?: string | null): ScopeResult {
  return inScopeAny([supplierCat, mpCat], title);
}

// Kitap (K 12.11: "kitap, gıda ve kadın iç giyim satamıyoruz"). ŞİMDİLİK YALNIZCA YENİ GÖNDERİMİ durdurur; satıştaki kitap ilanlarının
// stoğunu sıfırlamak K onayıyla (hafıza sales-restriction: toplu stok etkisini önce K'ya söyle). Tedarikçi yolunun ilk adımı hariç
// ("Kitap, Müzik, Film, Hobi >>> Parti Malzemeleri" kitap değil) kitap/dergi/roman/ansiklopedi/sözlük geçen adım ya da pazaryeri kategorisi.
const BOOK_SEG = /(^|\s)(kitap|kitaplar|kitapları|kitabı|roman|romanlar|romanları|dergi|dergiler|dergisi|ansiklopedi|ansiklopedisi|sözlük|sözlüğü|e-kitap)$/u; // adımın SON kelimesi ("Kitap Okuyucu Kılıfı" kitap değil)
export function bookBlock(supplierCat: string | null | undefined, mpCat: string | null | undefined): string | null {
  const segs = String(supplierCat ?? "").split(/>{1,3}|\//).map((s) => s.trim().toLocaleLowerCase("tr")).filter(Boolean);
  const hit = segs.slice(segs.length > 1 ? 1 : 0).find((s) => BOOK_SEG.test(s)) ?? (BOOK_SEG.test(String(mpCat ?? "").toLocaleLowerCase("tr").split(">").pop()?.trim() ?? "") ? String(mpCat) : null);
  return hit ? `kitap (${hit})` : null;
}

// Oyuncak uyumsuzluğu (K, 04.11: "beklediği gibi olmaz, ceza verir"): tedarikçide OYUNCAK kategorisindeki ürün pazaryerinde oyuncak dışı
// kategoride satılmaz (oyuncak süpürge "Araç İçi Süpürge", oyuncak blender "Bluetooth Kulaklık", oyuncak saz "Bağlama" olarak satılıyordu).
// Pazaryeri kategorisi oyuncak/çocuk/hobi türüyse ya da ürün zaten o türde kullanılan bir şeyse (kaykay, paten, pedallı araç...) geçer.
const TOY_SUP = /(oyuncak|oyun seti|oyun setleri)/u;
const TOY_MP_OK = /(parçalı|oyuncak|oyun|figür|peluş|bebek|lego|puzzle|yapboz|maket|eğitici|hobi|parti|kostüm|slime|balon|bisiklet|scooter|kaydırak|havuz|uçurtma|araba|model|plaj|kum|hamur|boya|kukla|maske|zıp|salıncak|meslek|evcilik|mutfak set|bilim|deney|kumanda|drone|robot|tren|kaykay|paten|pedallı|akülü araç|yürüteç|çadır|top)/u;
export function toyMismatch(supplierCat: string | null | undefined, mpCat: string | null | undefined): string | null {
  const s = fold(String(supplierCat ?? "").toLocaleLowerCase("tr")), m = String(mpCat ?? "").toLocaleLowerCase("tr");
  if (!m.trim() || !TOY_SUP.test(s)) return null;
  return TOY_MP_OK.test(m) || TOY_MP_OK.test(fold(m)) ? null : `tedarikçide oyuncak, pazaryerinde "${mpCat}" (yanlış tanıtım riski)`;
}

// Trendyol'un kendi satış kuralı (K, 06.11 ret listesi: figürlü çakmak, tütün/küllük, nargile, silah; oyuncak olsa da reddediliyor). Yalnızca Trendyol'a YENİ gönderimde; başka pazaryerini etkilemez.
const TY_RULE = /(?<![\p{L}])(çakmak|çakmağı|küllük|kül tablası|sigara|tütün|nargile|tabanca|tüfek|silah|silahı|mermi|mermili|şarjör|kasatura)(?![\p{L}])/u;
export function trendyolRuleBlock(title: string | null | undefined): string | null {
  const m = String(title ?? "").toLocaleLowerCase("tr").match(TY_RULE);
  return m ? `Trendyol satış kuralı: "${m[1]}" içeren ürün kabul edilmiyor` : null;
}

// +18 uyumsuzluğu (K, 06.11: "ceza riski yüksekse kapat"): tedarikçide +18 / cinsel sağlık / fantezi olan ürün pazaryerinde bebek, çocuk, oyuncak kategorisinde satılmaz (240 ilan "Bebek Sağlık Ürünleri"ne düşmüştü).
const ADULT_SUP = /(\+18|cinsel|fantezi|fantazi)/u;
const KID_MP = /(bebek|çocuk|oyuncak|anne)/u;
export function adultMismatch(supplierCat: string | null | undefined, mpCat: string | null | undefined): string | null {
  const s = String(supplierCat ?? "").toLocaleLowerCase("tr"), m = String(mpCat ?? "").toLocaleLowerCase("tr");
  return m.trim() && ADULT_SUP.test(s) && KID_MP.test(m) ? `tedarikçide +18, pazaryerinde "${mpCat}" (ceza riski)` : null;
}

