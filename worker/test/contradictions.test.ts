// Çelişki bulucu (malzeme, ürün tipi, ölçü) + etiketli doğruluk kümesi. Hedef: yanlış eylem SIFIR (emin değilse dokunma).
// node --experimental-strip-types worker/test/contradictions.test.ts
import { preciousClaim, dimStatements, dimsConsistent, detectAll, applyFindings, confirmAiContradiction, toLines, explicitMaterials, type DimReads } from "../core/contradictions.ts";
import { cleanHtml } from "../core/desc-check.ts";
import { LABELED } from "./fixtures/content-fix-labeled.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };

// Değerli metal iddiası
check("925 ayar gümüş malzemeden: iddia", !!preciousClaim("bu halhal, 925 ayar gümüş malzemeden üretilmiştir."));
check("gümüş renk: iddia değil", !preciousClaim("Gümüş renk çelik zincir kolye"));
check("gümüş kaplama: iddia değil", !preciousClaim("Gümüş kaplama olan bu küpeler"));
check("14 ayar altın kaplamalı: iddia değil", !preciousClaim("14 ayar altın kaplamalı çelik kolye"));
check("14 ayar altın bileklik: iddia", !!preciousClaim("14 ayar altın bileklik"));
check("925 ayar gümüş kaplama: iddia değil", !preciousClaim("925 ayar gümüş kaplama"));
check("Türkçe karaktersiz yazım", !!preciousClaim("925 ayar gumus malzemeden uretilmistir"));
check("açık malzeme: plastikten üretilmiştir", explicitMaterials("Tamamen plastikten üretilmiştir.").has("plastik"));
check("ahşap görünümlü açık malzeme değil", !explicitMaterials("Malzeme: ahşap görünümlü").has("ahsap"));

// Ölçü
check("birimli ölçü", JSON.stringify(dimStatements("Ölçü 10 x 10 x 10 cm")[0]?.values) === "[10,10,10]", dimStatements("Ölçü 10 x 10 x 10 cm"));
check("mm -> cm", JSON.stringify(dimStatements("Ürün boyutu 150 x 178 x 55 mm")[0]?.values) === "[15,17.8,5.5]", dimStatements("Ürün boyutu 150 x 178 x 55 mm"));
check("metre -> cm", JSON.stringify(dimStatements("1x2 metre ölçüsüyle")[0]?.values) === "[100,200]");
check("birimsiz ve etiketsiz sayılmaz (10x40 dürbün)", dimStatements("10x40 Metal Gövdeli Dürbün").length === 0);
check("etiketli birimsiz sayılır", dimStatements("Ölçü: 40x60").length === 1);
check("ondalık virgül", JSON.stringify(dimStatements("Kompakt boyut: 36 x 8,5 x 7,5 cm")[0]?.values) === "[36,8.5,7.5]");
check("alt küme tutarlı (18x17 / 18x17x4)", dimsConsistent([18, 17], [18, 17, 4]));
check("sıra önemsiz", dimsConsistent([13, 15, 20], [20, 13, 15]));
check("10x10x10 / 13x15x20 tutarsız", !dimsConsistent([10, 10, 10], [13, 15, 20]));

// Uygulama: çıkan cümle yok, HTML izinli, ölçü çıkınca not
{
  const p = LABELED.find((x) => x.id === "b28046f0")!;
  const f = detectAll(p);
  const r = applyFindings(p.description, p.title, f);
  check("halhal: 925 cümlesi çıktı", r.changed && !/925/.test(r.text), r.text);
  check("halhal: diğer cümleler korundu", /İnce işçilik/.test(r.text) && /farkınızı ortaya koyun/.test(r.text));
  check("halhal: HTML izinli", !cleanHtml(r.html).error, r.html);
}
{
  const p = LABELED.find((x) => x.id === "k-ayna-baslik")!;
  const r = applyFindings(p.description, p.title, detectAll(p));
  check("ayna: çelişen ölçü çıktı, not eklendi", !/40x60/.test(r.text) && /görseline bakınız/.test(r.text) && /Vida dahil/.test(r.text), r.text);
}
{
  const p = LABELED.find((x) => x.id === "068ed6ce-uzlasma")!;
  const reads: DimReads = { a: p.okuma!.a, b: p.okuma!.b, models: ["A", "B"] };
  const r = applyFindings(p.description, p.title, detectAll(p, { dimReads: reads }));
  check("disko: iki model uzlaştı -> görseldeki ölçü yazıldı", /13 x 15 x 20 cm/.test(r.text) && !/10 x 10 x 10/.test(r.text), r.text);
}
{
  const p = LABELED.find((x) => x.id === "k-bileklik-kolye")!;
  const r = applyFindings(p.description, p.title, detectAll(p));
  check("bileklik/kolye: gövde atıldı, başlıkla çelişmeyen satırlar kaldı", !/kolye/i.test(r.text) && /Malzeme: Çelik/.test(r.text) && /Renk: Gümüş/.test(r.text), r.text);
}

// Yapay zekâ önerisi kuralla doğrulanır
{
  const p = LABELED.find((x) => x.id === "b28046f0")!, lines = toLines(p.description);
  check("YZ: doğru alıntı + değerli metal -> kabul", !!confirmAiContradiction({ kind: "malzeme", quote: "925 ayar gümüş malzemeden üretilmiştir" }, p.title, p.category!, lines));
  check("YZ: açıklamada olmayan alıntı -> ret", !confirmAiContradiction({ kind: "malzeme", quote: "saf altından yapılmıştır" }, p.title, p.category!, lines));
  const q = LABELED.find((x) => x.id === "9cffb2b8")!;
  check("YZ: 'gümüş renk' önerisi -> ret", !confirmAiContradiction({ kind: "malzeme", quote: "bu gümüş renk çelik zincir kolye" }, q.title, q.category!, toLines(q.description)));
  check("YZ: tür malzeme değilse -> ret", !confirmAiContradiction({ kind: "renk", quote: "925 ayar gümüş malzemeden üretilmiştir" }, p.title, p.category!, lines));
}

// Etiketli küme: kesinlik / duyarlılık
let tp = 0, fp = 0, fn = 0;
const wrong: string[] = [];
for (const c of LABELED) {
  const reads: DimReads | null = c.okuma ? { a: c.okuma.a, b: c.okuma.b, models: ["A", "B"] } : null;
  const f = detectAll(c, { dimReads: reads });
  const got = { remove: f.filter((x) => x.kind === "malzeme" && x.action === "remove").length, drop: f.some((x) => x.action === "drop_body"), dims: (f.find((x) => x.kind === "olcu" && x.action !== "note")?.action ?? "none") as string };
  const e = c.expect;
  const actGot = got.remove + Number(got.drop) + Number(got.dims !== "none"), actExp = e.remove + Number(e.drop) + Number(e.dims !== "none");
  const exact = got.remove === e.remove && got.drop === e.drop && got.dims === e.dims;
  if (exact) tp += actExp; else {
    fp += Math.max(0, actGot - actExp) + (got.dims !== "none" && e.dims !== "none" && got.dims !== e.dims ? 1 : 0);
    fn += Math.max(0, actExp - actGot);
    wrong.push(`${c.id}: beklenen ${JSON.stringify(e)} bulunan ${JSON.stringify(got)}`);
  }
}
const prec = tp + fp ? tp / (tp + fp) : 1, rec = tp + fn ? tp / (tp + fn) : 1;
console.log(`Etiketli küme: ${LABELED.length} ürün · doğru eylem ${tp} · yanlış eylem ${fp} · kaçan ${fn} · kesinlik %${Math.round(prec * 100)} · duyarlılık %${Math.round(rec * 100)}`);
check("etiketli kümede yanlış eylem yok", fp === 0, wrong);
check("etiketli kümede kaçan yok", fn === 0, wrong);

if (fails) { console.log(`\n${fails} çelişki testi başarısız`); process.exit(1); }
console.log("\nÇelişki testleri geçti");
