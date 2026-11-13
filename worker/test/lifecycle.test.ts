// İlan yaşam döngüsü karar testi (core/lifecycle.ts planLifecycle). node --experimental-strip-types worker/test/lifecycle.test.ts
import { planLifecycle, type LcRow, type LcRetire } from "../core/lifecycle.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };
const now = Date.parse("2026-11-13T12:00:00Z");
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const row = (key: string, o: Partial<LcRow> = {}): LcRow => ({ key, productId: `p-${key.replace(/^TCX/, "")}`, inStock: false, productActive: true, outSince: null, status: "live", ...o });
const live = new Map<string, any>([
  ["TCXyeni0", { status: "active" }], ["TCXs49", { status: "active" }], ["TCXs47", { status: "active" }], ["TCXsatildi", { status: "active" }], ["TCXkalsin", { status: "active" }],
  ["TCXstoklu", { status: "active" }], ["TCXarsivStokGeldi", { status: "closed", archived: true }], ["TCXarsivOlu", { status: "closed", archived: true }],
  ["TCXarsivYeni", { status: "closed", archived: true }], ["TCXarsiv10gun", { status: "closed", archived: true }], ["TCXtoplu", { status: "closed", archived: true }], ["TCXkilitli", { status: "closed" }],
]);
const rows: LcRow[] = [
  row("TCXyeni0"), row("TCXs49", { outSince: ago(49) }), row("TCXs47", { outSince: ago(47) }), row("TCXsatildi", { outSince: ago(100) }), row("TCXkalsin", { outSince: ago(100) }),
  row("TCXstoklu", { inStock: true, outSince: ago(5) }),
  row("TCXarsivStokGeldi", { inStock: true, outSince: ago(80) }),
  row("TCXarsivOlu", { productActive: false, outSince: ago(80) }),
  row("TCXarsivYeni", { productActive: false, outSince: ago(80) }),
  row("TCXarsiv10gun", { outSince: ago(240) }),
  row("TCXtoplu", { outSince: ago(1) }),
  row("TCXkilitli", { outSince: ago(100) }),
  row("TCXsilinmisGeldi", { inStock: true, status: "gone" }),
  row("TCXtyKapatti", { inStock: true, status: "gone" }),
];
const retire = new Map<string, LcRetire>([
  ["TCXarsivStokGeldi", { archived_at: ago(30), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["TCXarsivOlu", { archived_at: ago(30), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["TCXarsivYeni", { archived_at: ago(10), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["TCXarsiv10gun", { archived_at: ago(30), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["TCXtoplu", { archived_at: ago(26), deleted_at: null, reason: "toplu temizlik (K 12.11): tedarikçide stok yok" }],
  ["TCXsilinmisGeldi", { archived_at: ago(100), deleted_at: ago(70), reason: "arşivde, tedarikçide yok / 30 gün stoksuz" }],
]);
live.set("SRS0001", { status: "closed", archived: true }); live.set("4522936381177", { status: "active" });
rows.push(row("SRS0001", { productActive: false, outSince: ago(100) }), row("4522936381177", { outSince: ago(100) }));
retire.set("SRS0001", { archived_at: ago(30), deleted_at: null, reason: "toplu temizlik (K 12.11): tedarikçide stok yok" });
const p = planLifecycle(rows, live, retire, { now, sold: new Set(["TCXsatildi"]), keep: new Set(["TCXkalsin"]) });
check("stoksuz kalan ilk kez işaretlenir", p.setOut.includes("TCXyeni0") && !p.setOut.includes("TCXs49"), p.setOut);
check("stok gelince işaret kalkar", p.clearOut.includes("TCXstoklu") && p.clearOut.includes("TCXarsivStokGeldi"), p.clearOut);
check("48 saati dolan arşivlenir, 47 saatlik beklemede", p.archive.includes("TCXs49") && !p.archive.includes("TCXs47"), p.archive);
check("son 30 günde satılan / kalsın / Trendyol'un kapattığı arşivlenmez", !p.archive.includes("TCXsatildi") && !p.archive.includes("TCXkalsin") && !p.archive.includes("TCXkilitli"), p.archive);
check("arşivde stok gelince arşivden çıkar", p.unarchive.includes("TCXarsivStokGeldi"), p.unarchive);
check("tedarikçide yok + arşivde 25 saat -> silinir", p.del.includes("TCXarsivOlu"), p.del);
check("arşivde 25 saat dolmadan silinmez", !p.del.includes("TCXarsivYeni"), p.del);
check("ürün aktif, 10 gün stoksuz -> silinmez (30 gün beklenir)", !p.del.includes("TCXarsiv10gun"), p.del);
check("K onaylı toplu temizlik 25 saat sonra silinir", p.del.includes("TCXtoplu"), p.del);
check("bizim sildiğimiz ürün stoğa girince yeniden gönderilir", p.resend.includes("p-silinmisGeldi"), p.resend);
check("Trendyol'un kaldırdığı (bizim kaydımız yok) yeniden gönderilmez", !p.resend.includes("p-tyKapatti"), p.resend);

check("K 14.11: kendi ilanı (tedarikçi barkodu değil) arşivlenmez/silinmez", ![...p.archive, ...p.del, ...p.setOut].some((k) => k === "SRS0001" || k === "4522936381177"), p);
if (fails) { console.log(`\n${fails} yaşam döngüsü testi başarısız`); process.exit(1); }
console.log("\nYaşam döngüsü testleri geçti");
