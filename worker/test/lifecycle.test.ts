// İlan yaşam döngüsü karar testi (core/lifecycle.ts planLifecycle). node --experimental-strip-types worker/test/lifecycle.test.ts
import { planLifecycle, type LcRow, type LcRetire } from "../core/lifecycle.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };
const now = Date.parse("2026-11-13T12:00:00Z");
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const row = (key: string, o: Partial<LcRow> = {}): LcRow => ({ key, productId: `p-${key}`, inStock: false, productActive: true, outSince: null, status: "live", ...o });
const live = new Map<string, any>([
  ["yeni0", { status: "active" }], ["s49", { status: "active" }], ["s47", { status: "active" }], ["satildi", { status: "active" }], ["kalsin", { status: "active" }],
  ["stoklu", { status: "active" }], ["arsivStokGeldi", { status: "closed", archived: true }], ["arsivOlu", { status: "closed", archived: true }],
  ["arsivYeni", { status: "closed", archived: true }], ["arsiv10gun", { status: "closed", archived: true }], ["toplu", { status: "closed", archived: true }], ["kilitli", { status: "closed" }],
]);
const rows: LcRow[] = [
  row("yeni0"), row("s49", { outSince: ago(49) }), row("s47", { outSince: ago(47) }), row("satildi", { outSince: ago(100) }), row("kalsin", { outSince: ago(100) }),
  row("stoklu", { inStock: true, outSince: ago(5) }),
  row("arsivStokGeldi", { inStock: true, outSince: ago(80) }),
  row("arsivOlu", { productActive: false, outSince: ago(80) }),
  row("arsivYeni", { productActive: false, outSince: ago(80) }),
  row("arsiv10gun", { outSince: ago(240) }),
  row("toplu", { outSince: ago(1) }),
  row("kilitli", { outSince: ago(100) }),
  row("silinmisGeldi", { inStock: true, status: "gone" }),
  row("tyKapatti", { inStock: true, status: "gone" }),
];
const retire = new Map<string, LcRetire>([
  ["arsivStokGeldi", { archived_at: ago(30), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["arsivOlu", { archived_at: ago(30), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["arsivYeni", { archived_at: ago(10), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["arsiv10gun", { archived_at: ago(30), deleted_at: null, reason: "48 saattir stoksuz" }],
  ["toplu", { archived_at: ago(26), deleted_at: null, reason: "toplu temizlik (K 12.11): tedarikçide stok yok" }],
  ["silinmisGeldi", { archived_at: ago(100), deleted_at: ago(70), reason: "arşivde, tedarikçide yok / 30 gün stoksuz" }],
]);
const p = planLifecycle(rows, live, retire, { now, sold: new Set(["satildi"]), keep: new Set(["kalsin"]) });
check("stoksuz kalan ilk kez işaretlenir", p.setOut.includes("yeni0") && !p.setOut.includes("s49"), p.setOut);
check("stok gelince işaret kalkar", p.clearOut.includes("stoklu") && p.clearOut.includes("arsivStokGeldi"), p.clearOut);
check("48 saati dolan arşivlenir, 47 saatlik beklemede", p.archive.includes("s49") && !p.archive.includes("s47"), p.archive);
check("son 30 günde satılan / kalsın / Trendyol'un kapattığı arşivlenmez", !p.archive.includes("satildi") && !p.archive.includes("kalsin") && !p.archive.includes("kilitli"), p.archive);
check("arşivde stok gelince arşivden çıkar", p.unarchive.includes("arsivStokGeldi"), p.unarchive);
check("tedarikçide yok + arşivde 25 saat -> silinir", p.del.includes("arsivOlu"), p.del);
check("arşivde 25 saat dolmadan silinmez", !p.del.includes("arsivYeni"), p.del);
check("ürün aktif, 10 gün stoksuz -> silinmez (30 gün beklenir)", !p.del.includes("arsiv10gun"), p.del);
check("K onaylı toplu temizlik 25 saat sonra silinir", p.del.includes("toplu"), p.del);
check("bizim sildiğimiz ürün stoğa girince yeniden gönderilir", p.resend.includes("p-silinmisGeldi"), p.resend);
check("Trendyol'un kaldırdığı (bizim kaydımız yok) yeniden gönderilmez", !p.resend.includes("p-tyKapatti"), p.resend);

if (fails) { console.log(`\n${fails} yaşam döngüsü testi başarısız`); process.exit(1); }
console.log("\nYaşam döngüsü testleri geçti");
