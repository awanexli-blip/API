// Yayındaki ilan yeniden gönderilince yalnızca değişen içerik: parmak izi varsa onunla, yoksa canlı içerikle
// node --experimental-strip-types worker/test/content-diff.test.ts
import { contentChanges, fpOf, descHashOf, normText } from "../core/content-diff.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const keys = (o: object) => Object.keys(o).sort().join(",");

const base = { title: "Boyun Masaj Aleti", description: "<p>Kablosuz <strong>masaj</strong> aleti</p>", images: ["https://a/1.jpg", "https://a/2.jpg"] };
const fp = fpOf(base);

check("iz var, değişiklik yok: hiçbir şey gitmez", keys(contentChanges(base, fp, {})) === "");
check("yalnızca başlık değişti", keys(contentChanges({ ...base, title: "Boyun ve Sırt Masaj Aleti" }, fp, {})) === "title");
check("yalnızca açıklama değişti", keys(contentChanges({ ...base, description: "<p>Kablosuz masaj aleti, 3 kademe</p>" }, fp, {})) === "description");
check("yalnızca görsel sırası değişti", keys(contentChanges({ ...base, images: [base.images[1], base.images[0]] }, fp, {})) === "images");
check("biçim farkı değişiklik değil (etiket, boşluk, büyük harf, &amp;)", keys(contentChanges({ ...base, description: "<div>kablosuz   MASAJ aleti</div>" }, fp, {})) === "");
check("hepsi değişti", keys(contentChanges({ title: "X", description: "Y", images: ["https://b/1.jpg"] }, fp, {})) === "description,images,title");

// Eski ilan (iz yok): canlı içerikle
const live = { title: "Boyun Masaj Aleti", descHash: descHashOf("<p>Kablosuz masaj aleti</p>"), images: ["https://cdn.ty/x1.jpg", "https://cdn.ty/x2.jpg"] };
check("iz yok, canlıyla aynı: gitmez (CDN adresi farklı ama sayı aynı)", keys(contentChanges(base, null, live)) === "");
check("iz yok, başlık canlıdan farklı", keys(contentChanges({ ...base, title: "Yeni Başlık" }, null, live)) === "title");
check("iz yok, görsel sayısı farklı", keys(contentChanges({ ...base, images: [...base.images, "https://a/3.jpg"] }, null, live)) === "images");
check("iz yok, açıklama özeti yok: açıklama gönderilmez (emin değil)", keys(contentChanges({ ...base, description: "tamamen farklı" }, null, { title: live.title })) === "");
check("boş başlık/açıklama/görsel asla gönderilmez", keys(contentChanges({ title: " ", description: "", images: [] }, fp, {})) === "");
check("normText: &nbsp; ve &#39;", normText("A&nbsp;B &#39;C&#39;") === "a b 'c'", normText("A&nbsp;B &#39;C&#39;"));

if (fails) { console.log(`\n${fails} içerik farkı testi başarısız`); process.exit(1); }
console.log("\nİçerik farkı testleri geçti");
