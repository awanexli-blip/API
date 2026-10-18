// Reddedilen ürünleri düzeltme (Trendyol). Saf fonksiyonlar test edilir; senkron (sync.ts) uygular.
// Ret türleri (Trendyol rejectReason): "Yasaklı Kelime", "Hatalı Marka Bilgisi", "Kategori Bilgisi Eksik veya Yanlış", diğerleri.
//  - Yasaklı kelime: ret açıklamasındaki tırnaklı kelimeler başlık/açıklamadan silinir, listeye eklenir (yeni ürünlerde de temizlenir)
//  - Hatalı marka: başlık sonundaki " -Marka" eki ve açıklamadaki o marka adı silinir (biz Eco Lounge ile açıyoruz)
//  - Kategori / tekrar eden ret / görsel: kullanıcı düzeltir (panel: Trendyol → Reddedilenler)
import type { Listing, RejectedUpdate } from "../marketplaces/types.ts";

const lower = (s: string) => s.toLocaleLowerCase("tr");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tidy = (s: string) => s.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, "").trim();

// Ret açıklamasından yasaklı kelimeler: ... ; "Redka" yasaklı kelimesi ... / "konteynır,konteynır" yasaklı ...
export function bannedFromReason(detail: string): string[] {
  const out = new Set<string>();
  for (const m of detail.matchAll(/"([^"]{1,80})"\s*yasakl/gi)) for (const w of m[1].split(",")) if (w.trim()) out.add(lower(w.trim()));
  return [...out];
}

// Kelimeleri sil (büyük/küçük harf duyarsız, kelime sınırında; Türkçe harfler dahil)
export function removeWords(text: string, words: string[]): string {
  let t = text;
  for (const w of words) {
    if (!w) continue;
    const re = new RegExp(`(^|[^0-9A-Za-zÇĞİÖŞÜçğıöşü])${esc(w)}(?=$|[^0-9A-Za-zÇĞİÖŞÜçğıöşü])`, "giu");
    t = t.replace(re, "$1");
    // Türkçe büyük harf (İ/I) farkı için ikinci deneme
    const reTr = new RegExp(`(^|[^0-9A-Za-zÇĞİÖŞÜçğıöşü])${esc(w.toLocaleUpperCase("tr"))}(?=$|[^0-9A-Za-zÇĞİÖŞÜçğıöşü])`, "gu");
    t = t.replace(reTr, "$1");
  }
  return tidy(t);
}

// Başlık sonundaki üretici markası: "Gökkuşağı Kule -Birlik" -> { title: "Gökkuşağı Kule", brand: "Birlik" }
export function stripBrandSuffix(title: string): { title: string; brand: string | null } {
  const m = title.match(/^(.*\S)\s+[-–]\s*([^-–]{2,40})$/);
  if (!m) return { title, brand: null };
  const brand = m[2].trim();
  if (brand.split(/\s+/).length > 4 || /\d{3,}/.test(brand)) return { title, brand: null }; // ölçü/model gibi görünüyorsa dokunma
  return { title: tidy(m[1]), brand };
}

// Yeni ürün metinlerini göndermeden temizle (ret almamak için)
export function cleanForMarketplace(title: string, description: string, banned: string[]) {
  const { title: t, brand } = stripBrandSuffix(title);
  let d = description;
  if (brand) d = removeWords(d, [brand]);
  return { title: removeWords(t, banned) || title, description: removeWords(d, banned) || d };
}

export type FixRow = { listing_key: string; attempts: number; status: string; proposed: any; last_attempt_at: string | null };
export type FixPlan =
  | { action: "resubmit"; update: RejectedUpdate; banned: string[]; note: string; fromUser: boolean }
  | { action: "needs_user"; note: string; banned: string[] }
  | { action: "wait" | "skip"; note: string };

const MAX_AUTO = 2;
const RETRY_HOURS = 6;

export function planFix(l: Listing, row: FixRow | undefined, ctx: { banned: string[]; xmlTitle?: string; xmlDetail?: string; now?: number }): FixPlan {
  const r = l.reject!;
  const types = r.types.map(lower).join(" | ");
  const details = r.details.join(" | ");
  if (row?.status === "gave_up") return { action: "skip", note: "vazgeçildi" };
  // Kullanıcının düzelttiği: önerilen alanlarla gönder
  if (row?.status === "user_ready") {
    const p = row.proposed ?? {};
    return { action: "resubmit", fromUser: true, banned: [], note: "kullanıcı düzeltmesi", update: { id: l.id, title: p.title || undefined, description: p.description || undefined, categoryId: p.category_id ? Number(p.category_id) : undefined, images: p.images?.length ? p.images : undefined } };
  }
  // Yakın zamanda gönderildiyse Trendyol'un yeni kararını bekle
  const now = ctx.now ?? Date.now();
  if (row?.last_attempt_at && now - new Date(row.last_attempt_at).getTime() < RETRY_HOURS * 3600_000) return { action: "wait", note: "son düzeltme yeni, Trendyol kararı bekleniyor" };
  const newBanned = /yasakl/.test(types) || /yasakl/i.test(details) ? bannedFromReason(details) : [];
  if (/kategori/.test(types)) return { action: "needs_user", banned: newBanned, note: "Kategori yanlış: doğru kategoriyi seç" };
  if ((row?.attempts ?? 0) >= MAX_AUTO) return { action: "needs_user", banned: newBanned, note: `${MAX_AUTO} otomatik düzeltmeden sonra yine reddedildi: başlık/açıklama/görseli kontrol et` };
  const isBrand = /marka/.test(types);
  const isBanned = newBanned.length > 0;
  if (!isBrand && !isBanned) return { action: "needs_user", banned: [], note: `Otomatik düzeltilemeyen ret: ${r.types.join(", ") || "neden belirtilmemiş"}` };

  const baseTitle = r.title ?? l.title ?? ctx.xmlTitle ?? "";
  const baseDesc = r.description ?? ctx.xmlDetail ?? "";
  let title = baseTitle, description = baseDesc;
  const words = [...new Set([...ctx.banned, ...newBanned])];
  let brand: string | null = null;
  if (isBrand) { const s = stripBrandSuffix(title); title = s.title; brand = s.brand; if (brand && description) description = removeWords(description, [brand]); }
  title = removeWords(title, words) || title;
  if (description) description = removeWords(description, words) || description;
  const changed = title !== baseTitle || (description && description !== baseDesc);
  if (!changed) return { action: "needs_user", banned: newBanned, note: isBrand ? "Marka uyuşmazlığı metinde bulunamadı: büyük olasılıkla görselde marka var, görseli değiştir" : "Yasaklı kelime metinde bulunamadı: elle düzelt" };
  return {
    action: "resubmit", fromUser: false, banned: newBanned,
    note: [brand && `başlıktaki "${brand}" markası silindi`, isBanned && `yasaklı kelime silindi: ${newBanned.join(", ")}`].filter(Boolean).join("; "),
    update: { id: l.id, title: title !== baseTitle ? title : undefined, description: description && description !== baseDesc ? description : undefined },
  };
}
