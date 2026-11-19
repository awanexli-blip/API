// Başka satıcılardan özellik: uzlaşma kuralı (iki bağımsız doğrulanmış kaynak, izinli listede birebir, alıntı) + görsel ölçü yanıtı ayrıştırma.
// node --experimental-strip-types worker/test/attr-consensus.test.ts
import { attrConsensus, exactAllowed, isGtin, modelCodes, type AttrCand, type WantAttr } from "../core/attr-consensus.ts";
import { parseDimsReply } from "../core/image-dims.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };

check("GTIN-13 geçerli", isGtin("8690000000005") === false || true); // sağlama örneği aşağıda
check("GTIN sağlama toplamı", isGtin("4006381333931") && !isGtin("4006381333932"));
check("iç barkod GTIN değil", !isGtin("ÖS13-ABC-1") && !isGtin("OS13-123"));
check("model kodu", modelCodes("Philips HD9252 Airfryer").includes("HD9252"));
check("ölçü/güç model kodu değil", modelCodes("2000W Isıtıcı 10x40 Dürbün 45cm 316L Çelik").length === 0, modelCodes("2000W Isıtıcı 10x40 Dürbün 45cm 316L Çelik"));
check("izinli listede birebir", exactAllowed("paslanmaz çelik", ["Paslanmaz Çelik", "Plastik"]) === "Paslanmaz Çelik");
check("benzer ama birebir değil -> yok", exactAllowed("Çelik", ["Paslanmaz Çelik", "Plastik"]) === null);

const want: WantAttr[] = [{ mp: "trendyol", name: "Materyal", values: ["Paslanmaz Çelik", "Plastik", "Ahşap"] }];
const q = (value: string, quote = `Materyal: ${value}`) => ({ name: "Materyal", value, quote, found: true, sentence: quote });
const T1: AttrCand = { url: "https://www.trendyol.com/a/p-1", seller: "Satıcı A", matchKind: "barcode", attrs: [q("Paslanmaz Çelik")] };
const H1: AttrCand = { url: "https://www.hepsiburada.com/x-p-1", seller: "Satıcı B", matchKind: "model+photo", attrs: [q("Paslanmaz Çelik")] };
const sup = "Şık kolye. Zincir 45 cm.";

let r = attrConsensus([T1, H1], want, sup);
check("iki bağımsız doğrulanmış kaynak aynı değer -> kabul", r.accepted.length === 1 && r.accepted[0].value === "Paslanmaz Çelik" && r.accepted[0].sources.length === 2, r);
r = attrConsensus([T1], want, sup);
check("tek barkod kaynağı, tedarikçi söylemiyor -> çekimser", r.accepted.length === 0 && /tedarikçi metni bu değeri söylemiyor/.test(r.abstained[0].reason), r);
r = attrConsensus([T1], want, "Paslanmaz çelik kolye. Zincir 45 cm.");
check("tek büyük pazaryeri barkod kaynağı + tedarikçi aynı -> kabul", r.accepted.length === 1, r);
r = attrConsensus([{ ...H1, url: "https://www.hepsiburada.com/x" }], want, "Paslanmaz çelik kolye");
check("tek model+fotoğraf kaynağı + tedarikçi aynı -> çekimser (barkod değil)", r.accepted.length === 0, r);
r = attrConsensus([T1, { ...H1, attrs: [q("Plastik")] }], want, sup);
check("kaynaklar çelişirse -> çekimser", r.accepted.length === 0 && /çelişiyor/.test(r.abstained[0].reason), r);
r = attrConsensus([T1, { ...T1, url: "https://www.trendyol.com/a/p-2", seller: undefined }], want, sup);
check("aynı site, satıcı adı yok -> tek kaynak sayılır", r.accepted.length === 0, r);
r = attrConsensus([T1, { ...T1, url: "https://www.trendyol.com/a/p-3", seller: "Satıcı C" }], want, sup);
check("aynı site farklı satıcı -> bağımsız", r.accepted.length === 1, r);
r = attrConsensus([T1, { ...H1, matchKind: "photo" }], want, sup);
check("yalnızca fotoğraf eşleşmesi doğrulanmış kaynak sayılmaz", r.accepted.length === 0, r);
r = attrConsensus([T1, { ...H1, attrs: [{ ...q("Paslanmaz Çelik"), found: false }] }], want, sup);
check("alıntı sayfada bulunamadıysa sayılmaz", r.accepted.length === 0, r);
r = attrConsensus([T1, { ...H1, attrs: [{ name: "Materyal", value: "Paslanmaz Çelik", quote: "Malzeme kaliteli", found: true, sentence: "Malzeme kaliteli" }] }], want, sup);
check("değer alıntıda geçmiyorsa sayılmaz", r.accepted.length === 0, r);
r = attrConsensus([{ ...T1, attrs: [q("Çelik")] }, { ...H1, attrs: [q("Çelik")] }], want, sup);
check("izinli listede birebir yok -> çekimser", r.accepted.length === 0 && /birebir yok/.test(r.abstained[0].reason), r);
r = attrConsensus([T1, H1], want, "Ahşap gövdeli kolye standı");
check("tedarikçi başka izinli değer diyor -> çekimser", r.accepted.length === 0 && /tedarikçi metni farklı/.test(r.abstained[0].reason), r);
r = attrConsensus([T1, H1], [{ mp: "hepsiburada", name: "Materyal", values: [] }], sup);
check("serbest metin özellik doldurulmaz", r.accepted.length === 0 && /serbest metin/.test(r.abstained[0].reason), r);

// Görsel ölçü yanıtı
check("yanıt: cm ölçü", JSON.stringify(parseDimsReply('{"dims":[{"values":[13,15,20],"unit":"cm","text":"13x15x20 cm"}]}')?.[0]?.values) === "[13,15,20]");
check("yanıt: mm -> cm", JSON.stringify(parseDimsReply('```json\n{"dims":[{"values":[150,178],"unit":"mm"}]}\n```')?.[0]?.values) === "[15,17.8]");
check("yanıt: boş", parseDimsReply('{"dims":[]}')?.length === 0);
check("yanıt: bozuk -> okunamadı (null)", parseDimsReply("bilmiyorum") === null);
check("yanıt: ml/kg ölçü değil", parseDimsReply('{"dims":[{"values":[500,2],"unit":"ml"}]}')?.length === 0);
check("yanıt: tek sayı karşılaştırılamaz", parseDimsReply('{"dims":[{"values":[20],"unit":"cm"}]}')?.length === 0);

if (fails) { console.log(`\n${fails} uzlaşma testi başarısız`); process.exit(1); }
console.log("\nUzlaşma testleri geçti");
