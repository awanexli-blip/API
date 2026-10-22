// Hepsiburada EK.4 komisyon eşleşmesi. node --experimental-strip-types worker/test/hepsiburada-commission.test.ts
import { readFileSync } from "node:fs";
import { hbCommissionMatcher, splitRow } from "../marketplaces/hepsiburada-commission.ts";
let fails = 0;
const check = (n: string, ok: boolean, info: unknown = "") => { console.log(`${ok ? "OK  " : "HATA"} ${n}${ok ? "" : "  " + JSON.stringify(info)}`); if (!ok) fails++; };

const rows = JSON.parse(readFileSync(new URL("../data/hepsiburada/commissions.json", import.meta.url), "utf8")).rows as { text: string }[];
const unsplit = rows.filter((r) => { const s = splitRow(r.text); return !s.main || !s.category || !s.items.length; });
check("tüm EK.4 satırları ana kategori / kategori / ürün grubu olarak ayrılır", unsplit.length === 0, unsplit.map((r) => r.text.slice(0, 60)));

const m = hbCommissionMatcher();
const rate = (cat: string, title: string) => m(cat, title)?.rate ?? null;
check("Bluetooth Hoparlör %16,67", rate("Bluetooth Hoparlör", "Bluetooth 5.4 Rgb Işıklı Soundbar Hoparlör") === 0.1667);
check("Tablet Aksesuarları %20 (Tablet %7 değil)", rate("Tablet Aksesuarları", "Dokunmatik Kalem Tablet Ve Telefon Uyumlu") === 0.2);
check("Telefon Kılıfı %25 (çoğul eki)", rate("Telefon Kılıfı", "Silikon Telefon Kılıfı iPhone 15 Uyumlu") === 0.25);
check("Mutfak Tartısı %15", rate("Mutfak Tartısı", "Hassas Elektronik Terazi 40 Kg") === 0.15);
check("Tıraş Makinesi %15", rate("Tıraş Makinesi", "Kablosuz Tıraş Makinesi") === 0.15);
check("Mikrofon %14", rate("Mikrofon", "Mıknatıslı Mikrofon Type C") === 0.14);
check("kategori ve başlık farklıysa yüksek oran (kablo %20)", rate("Kablolar", "Type C Data Şarj Kablosu 1 M") === 0.2);
check("tek kısa kelime başlıkta eşleşmez (Mobil ≠ Mobilya)", rate("", "Geniş Açılı Araç Kamerası Mobil Uygulama") === null);
check("bilinmeyen -> null (varsayılan oran)", rate("Yüz Masaj Aleti", "Doğal Jade Taş") === null);

if (fails) { console.log(`\n${fails} HB komisyon testi başarısız`); process.exit(1); }
console.log("\nHB komisyon testleri geçti");
