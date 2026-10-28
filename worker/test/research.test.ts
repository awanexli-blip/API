// Ürün araştırması kabul kuralları: aynı ürün, alıntı, sayı, çelişki, iddia; görsel dosya adı ipucu
// node --experimental-strip-types worker/test/research.test.ts
import { acceptFacts, imageHint, type Cand } from "../core/research.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };

const A: Cand = { url: "https://a", name: "X Masaj Aleti", same: true, facts: [
  { name: "Ölçü", value: "54x34x43 cm", quote: "Ürün ölçüsü 54x34x43 cm'dir", found: true, sentence: "Merhaba, ürün ölçüsü 54x34x43 cm'dir." },
  { name: "Seans süresi", value: "15 dakika", quote: "1 seanstan sonra - 15 dakika.", found: true, sentence: "Merhaba! 1 seanstan sonra - 15 dakika." },
  { name: "Ağırlık", value: "2 kg", quote: "Ağırlığı 1,5 kg", found: true, sentence: "Ağırlığı 1,5 kg" },
  { name: "Malzeme", value: "PU deri", quote: "PU deri kaplama", found: false },
  { name: "Garanti", value: "2 yıl garanti", quote: "2 yıl garantilidir", found: true, sentence: "2 yıl garantilidir" },
  { name: "Renk", value: "Siyah", quote: "Renk siyah", found: true, sentence: "Kutu içeriği: kablo" },
] };
const r1 = acceptFacts([A]);
const names = r1.facts.map((f) => f.name);
check("doğrulanmış ölçü kabul", names.includes("Ölçü"));
check("soru-cevaptaki süre kabul", names.includes("Seans süresi"));
check("değerdeki sayı alıntıda yoksa atılır", !names.includes("Ağırlık") && r1.dropped.some((d) => d.name === "Ağırlık" && d.reason.includes("sayı")));
check("sayfada bulunmayan alıntı atılır", !names.includes("Malzeme"));
check("garanti iddiası alınmaz", !names.includes("Garanti") && r1.dropped.some((d) => d.name === "Garanti"));
check("cümle alıntıyla uyuşmazsa atılır", !names.includes("Renk"));
check("kaynak adresi saklanır", r1.facts.every((f) => f.url === "https://a"));

const B: Cand = { url: "https://b", name: "Y", same: true, facts: [{ name: "ölçü", value: "50x30x40 cm", quote: "50x30x40 cm", found: true, sentence: "Ölçü 50x30x40 cm" }] };
const r2 = acceptFacts([A, B]);
check("iki ilan farklı ölçü verirse ikisi de atılır", !r2.facts.some((f) => /ölçü/i.test(f.name)) && r2.dropped.filter((d) => d.reason.includes("çelişki")).length === 2, r2);
const C: Cand = { url: "https://c", name: "Z", same: true, facts: [{ name: "Ölçü", value: "54 x 34 x 43 cm", quote: "54 x 34 x 43 cm", found: true, sentence: "Boyut: 54 x 34 x 43 cm" }] };
check("aynı ölçü farklı yazım çelişki sayılmaz", acceptFacts([A, C]).facts.filter((f) => /ölçü/i.test(f.name)).length === 1);
const D: Cand = { ...A, url: "https://d", same: false };
check("aynı ürün doğrulanmadıysa hiçbir bilgi alınmaz", acceptFacts([D]).facts.length === 0);

const M: Cand = { url: "https://m", name: "Q", same: true, facts: [
  { name: "Kullanım Alanları", value: "Spor sonrası ideal", quote: "Spor sonrası ideal", found: true, sentence: "Spor sonrası ideal" },
  { name: "Stok Kodu", value: "HBCV0000A7EZFK", quote: "HBCV0000A7EZFK", found: true, sentence: "Stok Kodu: HBCV0000A7EZFK" },
  { name: "Şarj süresi", value: "Şarj edilebilir bataryası sayesinde kablo karmaşası olmadan özgürce kullanabilirsiniz", quote: "Şarj edilebilir bataryası sayesinde kablo karmaşası olmadan özgürce kullanabilirsiniz", found: true, sentence: "Şarj edilebilir bataryası sayesinde kablo karmaşası olmadan özgürce kullanabilirsiniz" },
  { name: "Şarj süresi", value: "2 saat", quote: "Şarj süresi 2 saattir", found: true, sentence: "Şarj süresi 2 saattir." },
] };
const rm = acceptFacts([M]);
check("pazarlama / stok kodu / cümle değer alınmaz, somut süre alınır", rm.facts.length === 1 && rm.facts[0].value === "2 saat", rm);

check("görsel dosya adı ipucu", imageHint("https://percdn.com/f/882981/x/p/buffer-elektrikli-boyun-ve-sirt-masaj-aleti-kablosuz-1-44107388-sw1200sh1200.webp") === "buffer elektrikli boyun ve sirt masaj aleti kablosuz", imageHint("https://percdn.com/f/882981/x/p/buffer-elektrikli-boyun-ve-sirt-masaj-aleti-kablosuz-1-44107388-sw1200sh1200.webp"));
check("anlamsız dosya adı boş", imageHint("https://x/1-87076066-sw500sh500.webp") === "");

if (fails) { console.log(`\n${fails} araştırma testi başarısız`); process.exit(1); }
console.log("\nAraştırma testleri geçti");
