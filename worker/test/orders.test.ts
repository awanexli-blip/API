// Sipariş durumu haritası ve sipariş satırı (tahmini kâr, dikkat nedenleri) birim testleri.
// node --experimental-strip-types worker/test/orders.test.ts
import { mapOrderStatus } from "../core/order-status.ts";
import { orderRow } from "../core/orders.ts";
import { breakdown, defaultConfig as cfg } from "../pricing.ts";
import type { OrderIn } from "../marketplaces/types.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

check("durum: Created -> new", mapOrderStatus("trendyol", "Created").status === "new");
check("durum: Picking -> ready", mapOrderStatus("trendyol", "Picking").status === "ready");
check("durum: AtCollectionPoint -> shipped", mapOrderStatus("trendyol", "AtCollectionPoint").status === "shipped");
check("durum: UnSupplied -> cancelled", mapOrderStatus("trendyol", "UnSupplied").status === "cancelled");
const unk = mapOrderStatus("trendyol", "Uzayda");
check("durum: bilinmeyen yutulmaz (problem + neden)", unk.status === "problem" && /Uzayda/.test(unk.attention ?? ""), unk);
check("durum: UnDelivered dikkat ister", mapOrderStatus("trendyol", "UnDelivered").status === "problem");

const o: OrderIn = { packageId: "P1", orderNo: "O1", status: "Created", orderedAt: Date.UTC(2026, 9, 22, 10), total: 459, currency: "TRY", deadline: null, cargo: null, tracking: null, city: "İstanbul",
  lines: [{ lineNo: 1, key: "OS13-A", title: "A", qty: 1, unitPrice: 459 }] };
const refs = new Map([["OS13-A", { product_id: null, variant_id: null, commission: 0.1, cost: 118.33 }]]);
const r = orderRow("trendyol", o, refs, cfg);
check("satır: maliyet sipariş anından", r.lines[0].cost_snapshot === 118.33 && r.est_cost === 118.33, r);
check("satır: tahmini net = fiyat motoru", r.est_net === breakdown(459, 118.33, cfg, 0.1).net, { net: r.est_net, exp: breakdown(459, 118.33, cfg, 0.1).net });
check("satır: kişisel veri alanı yok", !("customer_name" in r) && !("address" in r) && r.city === "İstanbul");
const noCost = orderRow("trendyol", { ...o, lines: [{ ...o.lines[0], key: "BILINMEYEN" }] }, refs, cfg);
check("satır: maliyet yoksa kâr boş + dikkat nedeni", noCost.est_net === null && /Maliyeti bilinmeyen/.test(noCost.attention_reason ?? ""), noCost);
const cancelled = orderRow("trendyol", { ...o, status: "Cancelled" }, refs, cfg);
check("satır: iptalde kâr yok", cancelled.status === "cancelled" && cancelled.est_net === null, cancelled);
const two = orderRow("trendyol", { ...o, total: 918, lines: [{ ...o.lines[0], qty: 2 }] }, refs, cfg);
check("satır: çok adet maliyeti adetle çarpar", two.est_cost === 236.66 && two.units === 2, two);

if (fails) { console.log(`\n${fails} sipariş testi başarısız`); process.exit(1); }
console.log("\nSipariş testleri geçti");
