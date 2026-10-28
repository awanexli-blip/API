// Açıklama taslağı kontrolleri: kaynakta olmayan bilgi, iddia, HTML, iletişim, marka riski
// node --experimental-strip-types worker/test/desc-check.test.ts
import { checkDescription, cleanHtml } from "../core/desc-check.ts";
import { brandMatcher } from "../core/brand-risk.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };

const src = {
  title: "Gold Renk İşlemeli Kalp Küpe Pirinç Malzeme İle",
  description: "Şık ve zarif tasarımıyla Gold Renk İşlemeli Kalp Küpe, günlük kullanımda ve özel davetlerde tarzınızı tamamlar. Pirinç malzemeden üretilmiştir. Hafif yapısı sayesinde gün boyu rahat kullanım sunar. Ürün 1 çift olarak gönderilir. Boyu 2,5 cm.",
};
const good = "<p>Şık ve zarif tasarımıyla Gold Renk İşlemeli Kalp Küpe, günlük kullanımda ve özel davetlerde tarzınızı tamamlar.</p><ul><li><strong>Malzeme:</strong> Pirinç</li><li>Hafif yapısı sayesinde gün boyu rahat kullanım</li><li>Boyu: 2,5 cm</li><li>1 çift olarak gönderilir</li></ul>";
const r = checkDescription(good, src);
check("kaynağa sadık taslak geçer", r.ok, r.reasons);

check("uydurma sayı yakalanır", checkDescription(good.replace("2,5 cm", "3 cm"), src).reasons.some((x) => x.includes("sayı")));
check("uydurma iddia: orijinal", checkDescription(good + "<p>Orijinal ürün.</p>", src).reasons.some((x) => x.includes("orijinal")));
check("uydurma iddia: garanti", checkDescription(good + "<p>2 yıl garantilidir.</p>", src).reasons.some((x) => x.includes("garanti")));
check("uydurma iddia: kargo / indirim", checkDescription(good + "<p>Aynı gün kargo, indirimli fiyat.</p>", src).reasons.filter((x) => x.includes("iddia")).length >= 2);
check("uydurma iddia: su geçirmez", checkDescription(good + "<p>Suya dayanıklıdır.</p>", src).reasons.some((x) => x.includes("su geçirmez")));
check("uydurma model kodu", checkDescription(good.replace("Pirinç", "Pirinç (model GK200)"), src).reasons.some((x) => x.includes("kod")));
check("iletişim bilgisi", checkDescription(good + "<p>Bilgi için www.ornek.com</p>", src).reasons.some((x) => x.includes("iletişim")));
check("izinsiz etiket reddedilir", !checkDescription(good + "<script>x</script>", src).ok);
check("öznitelikli etiket reddedilir", !checkDescription('<p style="color:red">' + src.description + "</p>", src).ok);
check("çok kısa reddedilir", !checkDescription("<p>Küpe.</p>", src).ok);
check("bilgi atılırsa reddedilir", checkDescription("<p>Gold Renk İşlemeli Kalp Küpe çok güzel bir aksesuardır ve her kombine uyum sağlar, sevdiklerinize alabilirsiniz.</p>", src).reasons.some((x) => x.includes("atılmış")));
const bm = brandMatcher(["swarovski"]);
check("kaynakta olmayan marka riski", checkDescription(good + "<p>Swarovski taşlı görünüm.</p>", src, { brandMatch: bm }).reasons.some((x) => x.includes("marka")));
check("kaynakta zaten olan iddia serbest", checkDescription(good + "<p>Pirinç malzeme garantilidir.</p>", { ...src, description: src.description + " Ürün garantilidir." }).reasons.every((x) => !x.includes("garanti")));
check("yasaklı kelime", checkDescription(good.replace("Hafif", "Toplu alım hafif"), { ...src, description: src.description + " toplu alım" }, { banned: ["toplu alım"] }).reasons.some((x) => x.includes("yasaklı")));
check("Türkçe I/ı: IŞIK = ışık (yanlış alarm yok)", checkDescription("<p>LED IŞIKLI küçük gece lambası, yatak odası ve çocuk odası için uygun, yumuşak ışık verir ve pille çalışır, kablo gerektirmez.</p>", { title: "Led Işıklı Gece Lambası", description: "Led ışıklı küçük gece lambası yatak odası ve çocuk odası için uygundur, yumuşak ışık verir ve pille çalışır, kablo gerektirmez." }).ok);
check("br ve büyük harf etiket normalleşir", cleanHtml("<P>a<BR/>b</P>").html === "<p>a<br>b</p>", cleanHtml("<P>a<BR/>b</P>"));

if (fails) { console.log(`\n${fails} açıklama kontrol testi başarısız`); process.exit(1); }
console.log("\nAçıklama kontrol testleri geçti");
