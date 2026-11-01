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
  "külotlu çorap", "soket çorap", "patik çorap", "iç çamaşırı takımı", "fantezi giyim", "lohusa sabahlık", "erkek iç giyim", "kadın iç giyim"]);
// Yol parçasının TAMAMI gıda başlığıysa yasak (02.11: "Süpermarket, Pet Shop > Sağlık > Masaj Aleti" ve "Yiyecek & İçecek Hazırlama > Su Isıtıcı"
// gıda DEĞİL; parça içinde arama bunları eliyordu). İç giyim için parça içinde arama güvenli ("Giyim > İç Giyim > ...").
const FOOD_PART = /^(temel gıda|gıda|gıda ürünleri|kuru gıda|dondurulmuş gıda|organik gıda|yiyecek|yiyecekler|içecek|içecekler|atıştırmalık|atıştırmalıklar|takviye edici gıda|takviye edici gıdalar|gıda takviyeleri|kahvaltılık|kahvaltılıklar|şarküteri|et & tavuk|et, tavuk & balık|meyve & sebze|bebek maması|mama ve beslenme ürünleri)$/u;
const UNDER_PART = /(iç giyim|iç çamaşır|ic giyim)/u;
// Kategori yoksa başlıkta kesin iç giyim kelimesi
const UNDER_TITLE = /(?<![\p{L}])(külot|boxer|sütyen|iç çamaşır|çorap(?!lık)|atlet(?!ik)|fanila|jartiyer|babydoll|bralet|büstiyer)(?![\p{L}])/u;

function forbiddenCat(cat: string): string | null {
  for (const raw of cat.split(">")) {
    const s = raw.trim();
    if (!s) continue;
    if (FOOD_EXACT.has(s)) return `gıda (${s})`;
    if (UNDER_EXACT.has(s)) return `iç giyim (${s})`;
    if (UNDER_PART.test(s)) return `iç giyim (${s})`;
    if (FOOD_PART.test(s)) return `gıda (${s})`;
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
