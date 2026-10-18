// Reddedilen ürün düzeltme birim testleri (gerçek Trendyol ret metinleriyle).
// node --experimental-strip-types worker/test/rejections.test.ts
import { bannedFromReason, cleanForMarketplace, planFix, removeWords, stripBrandSuffix } from "../core/rejections.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

const R_BANNED = 'Ürün ismi ya da açıklamasında; "Redka" yasaklı kelimesi kullanılmıştır. Lütfen ürün ve içeriğinizin yayına uygunluğunu kontrol ediniz.';
const R_BANNED2 = 'Ürün ismi ya da açıklamasında; "konteynır,konteynır" yasaklı kelimesi kullanılmıştır.';
const R_BRAND = "Ürünün seçilen markası ile görsel, başlık veya açıklama kısmında belirtilen marka bilgileri birbiriyle uyuşmamaktadır.";
const R_CAT = "Ürün bilgileriniz (isim, görsel, barkod vb.) ile seçilen kategori arasında tutarsızlık tespit edilmiştir.";

check("yasaklı kelime çıkarımı", JSON.stringify(bannedFromReason(R_BANNED)) === '["redka"]' && JSON.stringify(bannedFromReason(R_BANNED2)) === '["konteynır"]', [bannedFromReason(R_BANNED), bannedFromReason(R_BANNED2)]);
check("kelime silme (büyük/küçük, Türkçe)", removeWords("Redka Ahşap Kule REDKA oyuncak", ["redka"]) === "Ahşap Kule oyuncak", removeWords("Redka Ahşap Kule REDKA oyuncak", ["redka"]));
check("kelime silme: kelimenin parçasına dokunmaz", removeWords("Konteynırlı Depo", ["konteynır"]) === "Konteynırlı Depo");
check("kelime silme: İ/ı", removeWords("KONTEYNIR Saklama", ["konteynır"]) === "Saklama", removeWords("KONTEYNIR Saklama", ["konteynır"]));
check("başlık sonu marka", JSON.stringify(stripBrandSuffix("URT021-002 Gökkuşağı Kule -Birlik")) === JSON.stringify({ title: "URT021-002 Gökkuşağı Kule", brand: "Birlik" }), stripBrandSuffix("URT021-002 Gökkuşağı Kule -Birlik"));
check("başlık sonu marka: boşluklu tire", stripBrandSuffix("1741 Flash Card İlk 100 Hayvanlar Eğitici Kartlar - Dıytoy").brand === "Dıytoy");
check("başlık: ölçü/model eki marka sayılmaz", stripBrandSuffix("Kablo 2 Metre -1234567").brand === null && stripBrandSuffix("Lavabo Sifonu Bx40").brand === null);
check("yeni ürün temizliği", JSON.stringify(cleanForMarketplace("Redka Kule -Birlik", "Birlik markalı Redka kule", ["redka"])) === JSON.stringify({ title: "Kule", description: "markalı kule" }), cleanForMarketplace("Redka Kule -Birlik", "Birlik markalı Redka kule", ["redka"]));

const L = (types: string[], details: string[], title = "URT021-002 Gökkuşağı Kule -Birlik", description = "Birlik Gökkuşağı Kule ahşap") => ({ id: "OS13-X", title, price: 1, quantity: 1, status: "pending" as const, reject: { types, details, title, description } });
{
  const p = planFix(L(["Hatalı Marka Bilgisi"], [R_BRAND]), undefined, { banned: [] });
  check("marka: başlık ve açıklama temizlenip gönderilir", p.action === "resubmit" && p.update.title === "URT021-002 Gökkuşağı Kule" && p.update.description === "Gökkuşağı Kule ahşap", p);
  const b = planFix(L(["Yasaklı Kelime"], [R_BANNED], "Redka Ahşap Kule", "Redka marka kule"), undefined, { banned: [] });
  check("yasaklı: kelime silinir, listeye eklenir", b.action === "resubmit" && b.update.title === "Ahşap Kule" && b.banned.includes("redka"), b);
  const c = planFix(L(["Kategori Bilgisi Eksik veya Yanlış"], [R_CAT]), undefined, { banned: [] });
  check("kategori: kullanıcıya bırakılır", c.action === "needs_user" && /kategori/i.test(c.note), c);
  const n = planFix(L(["Hatalı Marka Bilgisi"], [R_BRAND], "Ahşap Kule", "Ahşap kule"), undefined, { banned: [] });
  check("marka metinde yoksa: görsel değiştir", n.action === "needs_user" && /görsel/.test(n.note), n);
  const m = planFix(L(["Hatalı Marka Bilgisi"], [R_BRAND]), { listing_key: "OS13-X", attempts: 2, status: "resubmitted", proposed: {}, last_attempt_at: "2020-01-01T00:00:00Z" }, { banned: [] });
  check("2 denemeden sonra kullanıcıya", m.action === "needs_user", m);
  const w = planFix(L(["Hatalı Marka Bilgisi"], [R_BRAND]), { listing_key: "OS13-X", attempts: 1, status: "resubmitted", proposed: {}, last_attempt_at: new Date().toISOString() }, { banned: [] });
  check("yeni gönderildiyse bekle", w.action === "wait", w);
  const u = planFix(L(["Kategori Bilgisi Eksik veya Yanlış"], [R_CAT]), { listing_key: "OS13-X", attempts: 0, status: "user_ready", proposed: { category_id: "1012", title: "Yeni Başlık" }, last_attempt_at: null }, { banned: [] });
  check("kullanıcı düzeltmesi gönderilir", u.action === "resubmit" && u.update.categoryId === 1012 && u.update.title === "Yeni Başlık" && u.fromUser, u);
  const g = planFix(L(["Hatalı Marka Bilgisi"], [R_BRAND]), { listing_key: "OS13-X", attempts: 0, status: "gave_up", proposed: {}, last_attempt_at: null }, { banned: [] });
  check("vazgeçilen atlanır", g.action === "skip");
}

if (fails) { console.log(`\n${fails} ret testi başarısız`); process.exit(1); }
console.log("\nRet düzeltme testleri geçti");
