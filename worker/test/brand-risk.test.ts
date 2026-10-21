// Marka riski eşleşmesi: kelime sınırı, Türkçe harf, çok kelimeli marka, açıklama
// node --experimental-strip-types worker/test/brand-risk.test.ts
import { brandMatcher, DEFAULT_BLOCKLIST } from "../core/brand-risk.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const m = brandMatcher(DEFAULT_BLOCKLIST);
check("iPhone başlıkta", m("Lopard Apple iPhone X Kılıf") === "apple");
check("büyük harf İ/I", m("İPHONE UYUMLU KILIF") === "iphone");
check("çok kelimeli marka", m("Hello Kitty Desenli Çanta") === "hello kitty");
check("açıklamada geçen", m("Desenli Kılıf", "Samsung modelleriyle uyumludur") === "samsung");
check("kelime içinde eşleşmez (lg ≠ algı)", m("Algılayıcı Sensörlü Lamba") === null, m("Algılayıcı Sensörlü Lamba"));
check("markasız ürün geçer", m("Siyah Plastik Kirli Sepeti", "Dayanıklı plastik") === null);
check("Elsa karakteri", m("Elsa Prenses Kostüm") === "elsa");
if (fails) { console.log(`\n${fails} marka testi başarısız`); process.exit(1); }
console.log("\nMarka riski testleri geçti");
