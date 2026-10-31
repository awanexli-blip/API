// Faaliyet kapsamı (K, 31.10: vergi dairesi faaliyet kodları dışındaki ürünler satılamaz). Saf; worker ve panel kullanır, testli.
// Kodlar: 475401 beyaz eşya + elektrikli küçük ev aleti (radyo, TV, fotoğraf hariç) · 477104 dış giyim (palto, kaban, anorak, takım elbise,
// ceket, pantolon, şort) · 477201 ayakkabı, terlik vb. (spor ayakkabı ve tamamı tekstil olanlar hariç).
// Girdi: pazaryeri kategori adı (Trendyol) ve/veya tedarikçi kategori yolu + başlık. Belirsiz (masaj aleti, tartı) KAPSAM DIŞI sayılır (güvenli taraf).
// Açma/kapama: app_state "scope_filter" = "on" (açık) / başka (kapalı). Açıkken kapsam dışı ilanın stoğu 0, yeni gönderim yapılmaz.

export type ScopeGroup = "ev_aleti" | "dis_giyim" | "ayakkabi";
export type ScopeResult = { ok: boolean; group?: ScopeGroup; reason?: string };

const APPLIANCE = /(tıraş makinesi|traş makinesi|saç düzleştirici|saç maşası|saç kurutma|fön makinesi|epilatör|hava nemlendirici|hava temizleyici|vantilatör|elektrikli ısıtıcı|(?<![\p{L}])ısıtıcı(?![\p{L}])|klima|halı yıkama|elektrikli süpürge|dikey süpürge|robot süpürge|araç içi süpürge|şarjlı süpürge|tüy toplayıcı|kahve makinesi|çay makinesi|blender|mikser|doğrayıcı|rondo|mutfak robotu|tost makinesi|ekmek kızartma|kettle|su ısıtıcı|(?<![\p{L}])ütü(?![\p{L}])|buharlı ütü|fritöz|airfryer|air fryer|buzdolabı|çamaşır makinesi|kurutma makinesi|bulaşık makinesi|mikrodalga|mini fırın|elektrikli fırın|ankastre|elektrikli ocak|meyve sıkacağı|narenciye sıkacağı|katı meyve|waffle makinesi|yoğurt makinesi|elektrikli öğütücü|kahve öğütücü|derin dondurucu|şofben|termosifon|izgara makinesi|el blender)/iu;
const OUTERWEAR = /((?<![\p{L}])mont(?![\p{L}])|kaban|palto|anorak|(?<![\p{L}])ceket|takım elbise|pantolon|(?<![\p{L}])şort|trençkot|parka|blazer)/iu;
const SHOES = /(ayakkabı|(?<![\p{L}])bot(?![\p{L}])|çizme|terlik|sandalet|babet|loafer|topuklu|oxford|makosen)/iu;
// Aynı kelimeyi taşıyan ama kapsam dışı ürünler: oyuncak/süs, düzenleyici, manuel alet, spor ayakkabı, tekstil terlik, radyo/TV/fotoğraf
const EXCLUDE = /(oyuncak|figür|maket|minyatür|anahtarlık|kolye|küpe|bileklik|kostüm|kılıf|sticker|magnet|düzenleyici|organizer|ayakkabılık|çakmağı|fırçası ve süpürge|bardaklık|sıcak su torbası|sneaker|spor ayakkabı|koşu ayakkabısı|yürüyüş ayakkabısı|ev terliği|panduf|patik|çorap|radyo|televizyon|(?<![\p{L}])tv(?![\p{L}])|fotoğraf|kamera|yedek parça|aparatı|bıçağı|filtresi|başlığı|kablosu)/iu;

export function inScope(x: { cat?: string | null; title?: string | null }): ScopeResult {
  // Türkçe küçük harf: "Araç İçi Süpürge" (i bayrağı İ/ı'yı katlamaz)
  const cat = String(x.cat ?? "").toLocaleLowerCase("tr"), title = String(x.title ?? "").toLocaleLowerCase("tr");
  const text = `${cat} ${title}`;
  if (EXCLUDE.test(text)) return { ok: false, reason: `kapsam dışı (${text.match(EXCLUDE)?.[0] ?? ""})` };
  // Kategori varsa YALNIZCA kategori (kesin; başlıktaki kelime yanıltmasın: "Saç Kurutma Makinesi Görünümlü Hoparlör"), yoksa başlık
  const s = cat.trim() ? cat : title;
  if (APPLIANCE.test(s)) return { ok: true, group: "ev_aleti" };
  if (OUTERWEAR.test(s)) return { ok: true, group: "dis_giyim" };
  if (SHOES.test(s)) return { ok: true, group: "ayakkabi" };
  return { ok: false, reason: "faaliyet kodları dışında" };
}

export const SCOPE_LABEL: Record<ScopeGroup, string> = { ev_aleti: "Beyaz eşya / elektrikli küçük ev aleti", dis_giyim: "Dış giyim", ayakkabi: "Ayakkabı / terlik" };
