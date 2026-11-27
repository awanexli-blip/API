// Satış kısıtı (K, 16.11: "biz tüm ürünleri satabiliyoruz gıda hariç"; iç giyim ve kitap yasağı kalktı). Saf; worker kullanır, testli.
// Yasak: yalnızca gıda/içecek (su, kola, makarna, çikolata, bebek maması ...).
// Gıda DEĞİL: kahve makinesi, çay fincanı, mama kabı, mama sandalyesi, gıda saklama kabı (alet/kap).
// K 28.11: EVCİL HAYVAN MAMASI DA GIDA SAYILIR (mama, yaş/kuru mama, konserve, ödül, kemik, yem, vitamin): satılmaz. Kategori + başlık (pet bağlamında).
// Girdi: pazaryeri kategori adı ve/veya tedarikçi kategori yolu ("A > B > C"); kategori yoksa satılabilir (başlıktaki gıda kelimesi elemez).
// Açma/kapama: app_state "scope_filter" = "on" (açık) / başka (kapalı). Açıkken yasak ilanın stoğu 0, yeni gönderim yapılmaz.

export type ScopeGroup = "genel";
export type ScopeResult = { ok: boolean; group?: ScopeGroup; reason?: string };

// Kategori adının (ya da yol parçasının) TAMAMI bunlardan biriyse yasak
const FOOD_EXACT = new Set(["su", "kola", "makarna", "pirinç", "bakliyat", "zeytinyağı", "sıvı yağ", "çikolata", "sağlıklı atıştırmalık", "atıştırmalık", "bebek bisküvisi",
  "kavanoz maması", "bebek maması", "devam sütü", "şeker hamuru", "kahve", "türk kahvesi", "filtre kahve", "çay", "bitki çayı", "bal", "reçel", "baharat", "kuruyemiş", "cips", "bisküvi",
  "gofret", "kek", "şeker", "şekerleme", "sakız", "lokum", "un", "süt", "peynir", "yoğurt", "tereyağı", "et", "tavuk", "konserve", "salça", "sos", "ketçap", "mayonez", "tuz", "sirke",
  "mercimek", "nohut", "bulgur", "yulaf", "kahvaltılık gevrek", "granola", "protein tozu", "gıda takviyesi", "vitamin", "enerji içeceği", "maden suyu", "meyve suyu", "gazlı içecek",
  "soğuk çay", "hazır çorba", "pekmez", "tahin", "helva", "zeytin", "turşu", "dondurma", "sporcu besini",
  // Colezium (17.11) "Gıda Market" alt başlıkları (aynı başlık altında parfüm/kozmetik/temizlik de var: yalnızca gıda adımları)
  "pekmez ekşi sos sirke", "tuz çeşitleri", "tuz, kaya tuzu ürünleri", "gıda boyası", "şifalı bitkiler", "şifalı bitki a'dan z'ye", "mutfak baharatları",
  "baharat çeşitleri", "harçlar ve baharat karışımları", "bitkisel kapsül tablet", "bitkisel karışımlı kapsül", "kuruyemiş çeşitleri", "bitki çayları"]);
// Yol parçasının TAMAMI gıda başlığıysa yasak (02.11: "Süpermarket, Pet Shop > Sağlık > Masaj Aleti" ve "Yiyecek & İçecek Hazırlama > Su Isıtıcı"
// gıda DEĞİL; parça içinde arama bunları eliyordu).
const FOOD_PART = /^(temel gıda|gıda|gıda ürünleri|kuru gıda|dondurulmuş gıda|organik gıda|yiyecek|yiyecekler|içecek|içecekler|atıştırmalık|atıştırmalıklar|takviye edici gıda|takviye edici gıdalar|gıda takviyeleri|kahvaltılık|kahvaltılıklar|şarküteri|et & tavuk|et, tavuk & balık|meyve & sebze|bebek maması|mama ve beslenme ürünleri)$/u;
// 04.11: Bezos kategorileri Türkçe karaktersiz ("Temel Gida", "Icecekler", "Gıda ve İçecek Ürünleri"): karşılaştırma harfleri düzleştirerek yapılır
const fold = (x: string) => x.replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o");
const FOOD_EXACT_F = new Set([...FOOD_EXACT].map(fold));
const FOOD_PART_F = new RegExp(fold(FOOD_PART.source).replace("^(", "^(gida ve icecek urunleri|gida ve icecek|gida urunleri ve icecekler|"), "u");

// K 28.11: mama (evcil hayvan + bebek) ve 27.11 taramasında kaçan Bezos gıda başlıkları ("Bebek Mamalari", "Konserve Salca ve Hazir Yemek",
// "Kuruyemiş Şekerleme"). Yol parçasında gıda sözcüğü + kap/sandalye/aksesuar gibi gıda dışı sözcük yoksa yasak.
const MAMA_WORD = /(^|[\s&,(])(mama|mamalar|mamalari|mamasi|yas mama|kuru mama|konserve|konservesi|konserveler|odul|odulu|odulleri|kemik|kemikleri|yem|yemi|yemleri|vitamin|vitaminleri|hazir yemek|kuruyemis|seker|sekerleme|corba|kraker|biskuvi|macun|malt)($|[\s&,)])/u;
const NOT_FOOD = /(kap|kabi|kaplari|kab|kase|sandalye|onluk|aksesuar|oyuncak|tasma|tarak|yatak|kafes|biberon|emzik|sise|kasik|catal|termos|saklama|dispenser|otomatik)/u;
const PET = /(kedi|kopek|kus|balik|kemirgen|hamster|tavsan|papagan|muhabbet|kanarya|yavru|yetiskin|kisirlastirilmis|pet|evcil|akvaryum)/u;
function petOrBabyFoodPart(f: string): boolean {
  if (/(bebek mamalari|kavanoz mamalari|kasik mama|biberon mamalari|devam sutu)/u.test(f)) return true; // insan (bebek) gıdası
  return MAMA_WORD.test(f) && !NOT_FOOD.test(f);
}
/** Başlık (pet bağlamı): "Tavuklu Yavru Kedi Maması 1,5 Kg", "Köpek Ödül Çubuğu" -> gıda; "Kedi Mama Kabı" -> değil */
export function petFoodTitle(title: string | null | undefined): boolean {
  const t = fold(String(title ?? "").toLocaleLowerCase("tr"));
  if (!PET.test(t) || NOT_FOOD.test(t)) return false;
  return /(mamasi|mama|konserve|odul|kemik(?!li oyuncak)|corba|kraker|biskuvi|macun|malt|yem|yemi|vitamin|pate|jole|sos icinde|pouch)/u.test(t);
}

function forbiddenCat(cat: string): string | null {
  for (const raw of cat.split(">")) {
    const s = raw.trim();
    if (!s) continue;
    if (FOOD_EXACT.has(s) || FOOD_EXACT_F.has(fold(s))) return `gıda (${s})`;
    if (FOOD_PART.test(s) || FOOD_PART_F.test(fold(s))) return `gıda (${s})`;
    if (petOrBabyFoodPart(fold(s))) return `gıda/mama (${s})`;
  }
  return null;
}

export function inScope(x: { cat?: string | null; title?: string | null }): ScopeResult {
  // Türkçe küçük harf: "İç Giyim" (i bayrağı İ/ı'yı katlamaz)
  const cat = String(x.cat ?? "").toLocaleLowerCase("tr");
  const f = cat.trim() ? forbiddenCat(cat) : null;
  if (f) return { ok: false, reason: `satılamaz: ${f}` };
  // K 28.11: mama başlığı (kategori genel olsa da, ör. "Pet Shop" altında "Kedi Maması 1,5 Kg")
  if (petFoodTitle(x.title)) return { ok: false, reason: "satılamaz: gıda/mama (başlık)" };
  return { ok: true, group: "genel" };
}

// Tedarikçinin KDV oranı %1 / %0 (04.11): Türkiye'de %1 KDV neredeyse yalnızca temel gıda (çay, pirinç, yağ, helva...); %0 da şüpheli
// (ör. sofra takımı %0 yazılmış: oran yanlış -> fatura yanlış kesilir). İkisi de satılmaz, tedarikçiyle doğrulanmalı.
export function vatSuspect(vat: unknown): string | null {
  const v = vat == null || vat === "" ? null : Number(vat);
  return v === 1 ? "tedarikçi KDV %1 (temel gıda olabilir)" : v === 0 ? "tedarikçi KDV %0 (oran şüpheli: tedarikçiyle doğrula)" : null;
}

export const SCOPE_LABEL: Record<ScopeGroup, string> = { genel: "Satılabilir (gıda dışı)" };

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

