// Elle değişiklik koruması (worker/core/holds.ts): pazaryerinde elle düzenlenen / eklenen ilan K karar verene kadar ezilmez
// node --experimental-strip-types worker/test/holds.test.ts
import { decide, decideZero, holdText, holdButtons } from "../core/holds.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const it = { id: "K1", price: 299.9, quantity: 12 };
const ls = (price: number, quantity: number): any => ({ id: "K1", price, quantity, title: "Priz", status: "active" });
const sent = (o: Partial<any> = {}): any => ({ sent_price: 299.9, sent_qty: 12, price: 289.9, stock: 10, pushed_at: "2026-10-30T10:00:00Z", first_seen_at: null, ...o });
const o = { fresh: false, soldRecently: 0 };

check("değişiklik yok: gönderilir", decide(it, ls(299.9, 12), sent(), undefined, o).action === "push");
check("satış stoğu düşürdü: elle sayılmaz", decide(it, ls(299.9, 9), sent(), undefined, o).action === "push");
check("gecikme (pazaryeri hâlâ eski değerde): elle sayılmaz", decide(it, ls(289.9, 10), sent(), undefined, o).action === "push");
const ed = decide(it, ls(349.9, 12), sent(), undefined, o);
check("fiyat elle değişti: bekletilir", ed.action === "skip" && ed.detect === "edited", ed);
check("stok elle artırıldı: bekletilir", decide(it, ls(299.9, 50), sent(), undefined, o).detect === "edited");
check("stok elle 0 (son günde satış yok): bekletilir", decide(it, ls(299.9, 0), sent(), undefined, o).detect === "edited");
check("stok 0 ama satış var: elle sayılmaz", decide(it, ls(299.9, 0), sent(), undefined, { ...o, soldRecently: 12 }).action === "push");
check("bekleyen karar: dokunulmaz", decide(it, ls(349.9, 12), sent(), { id: "h", listing_key: "K1", status: "pending", kind: "edited" }, o).action === "skip");
check("hepsi kalsın: dokunulmaz", decide(it, ls(349.9, 12), sent(), { id: "h", listing_key: "K1", status: "keep_all", kind: "edited" }, o).action === "skip");
check("fiyat kalsın: yalnızca stok", decide(it, ls(349.9, 12), sent(), { id: "h", listing_key: "K1", status: "keep_price", kind: "edited" }, o).action === "qty_only");
const sy = decide(it, ls(349.9, 12), sent(), { id: "h", listing_key: "K1", status: "sync", kind: "edited" }, o);
check("sistemle eşitle: gönderilir ve karar kapanır", sy.action === "push" && sy.resolve === true);
check("eski ilan, hiç gönderilmemiş (özellik öncesi): ilk gönderim sessiz", decide(it, ls(349.9, 12), sent({ pushed_at: null, sent_price: null }), undefined, o).action === "push");
check("yeni ilan, fiyatı sistemden farklı: elle eklenmiş", decide(it, ls(349.9, 12), sent({ pushed_at: null, sent_price: null, first_seen_at: "2026-10-31T00:00:00Z" }), undefined, o).detect === "manual_new");
check("yeni ilan, fiyatı sistemle aynı (bizim açtığımız): gönderilir", decide(it, ls(299.9, 12), sent({ pushed_at: null, first_seen_at: "2026-10-31T00:00:00Z" }), undefined, o).action === "push");
check("tabloda hiç yok + koruma başlamış: yeni sayılır", decide(it, ls(349.9, 5), undefined, undefined, { ...o, fresh: true }).detect === "manual_new");
check("tabloda yok + ilk çalışma: sessiz", decide(it, ls(349.9, 5), undefined, undefined, o).action === "push");

check("sıfırlama: eski bağsız ilan sıfırlanır", decideZero(sent({ pushed_at: null }), undefined, false).action === "push");
check("sıfırlama: özellikten sonra eklenmiş bağsız ilan sorulur", decideZero(sent({ pushed_at: null, first_seen_at: "2026-10-31T00:00:00Z" }), undefined, false).detect === "manual_new");
check("sıfırlama: kalsın kararı varsa sıfırlanmaz", decideZero(sent(), { id: "h", listing_key: "K1", status: "keep_all", kind: "manual_new" }, false).action === "skip");
check("sıfırlama: eşitle kararıyla sıfırlanır", decideZero(sent(), { id: "h", listing_key: "K1", status: "sync", kind: "manual_new" }, false).resolve === true);

const t = holdText("Trendyol", { listing_key: "K1", kind: "edited", title: "Priz <Çift>", mp_price: 349.9, mp_qty: 12, our_price: 299.9, our_qty: 12, sent_price: 299.9, sent_qty: 12 });
check("mesaj: fiyatlar ve kaçış", /349,90 TL/.test(t) && /299,90 TL/.test(t) && /&lt;Çift&gt;/.test(t), t);
check("düğme verisi 64 bayt altı", holdButtons("123e4567-e89b-12d3-a456-426614174000").flat().every((b) => Buffer.byteLength(b.data) <= 64));

if (fails) { console.log(`${fails} hata`); process.exit(1); }
