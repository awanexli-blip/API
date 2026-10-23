// Sipariş durumu haritası ve sipariş satırı (tahmini kâr, dikkat nedenleri) birim testleri.
// node --experimental-strip-types worker/test/orders.test.ts
import { mapOrderStatus } from "../core/order-status.ts";
import { orderRow } from "../core/orders.ts";
import { breakdown, defaultConfig as cfg } from "../pricing.ts";
import type { OrderIn } from "../marketplaces/types.ts";
import { hbOrder, mergeOrder } from "../marketplaces/hepsiburada.ts";

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
check("satır: alıcı bilgisi yoksa boş, telefon alanı hiç yok", r.customer_name === null && r.address === null && !("customer_phone" in r) && r.city === "İstanbul", r);
const withCust = orderRow("trendyol", { ...o, customer: { name: "Ad Soyad", address: { fullAddress: "Sokak 1", city: "İstanbul" } } }, refs, cfg);
check("satır: alıcı ad + adres (tedarikçi siparişi için)", withCust.customer_name === "Ad Soyad" && withCust.address?.fullAddress === "Sokak 1");
const tyd = orderRow("trendyol", { ...o, total: 446.4, lines: [{ ...o.lines[0], unitPrice: 446.4, listPrice: 469.9, discount: 23.5, tyDiscount: 23.5 }] }, refs, cfg);
check("satır: Trendyol'un karşıladığı indirim gelire eklenir", tyd.est_net === breakdown(469.9, 118.33, cfg, 0.1).net, tyd);
const own = orderRow("trendyol", { ...o, total: 446.4, lines: [{ ...o.lines[0], unitPrice: 446.4, listPrice: 469.9, discount: 23.5, tyDiscount: 0 }] }, refs, cfg);
check("satır: satıcının kendi indirimi kârdan düşer", own.est_net === breakdown(446.4, 118.33, cfg, 0.1).net, own);
const noCost = orderRow("trendyol", { ...o, lines: [{ ...o.lines[0], key: "BILINMEYEN" }] }, refs, cfg);
check("satır: maliyet yoksa kâr boş + dikkat", noCost.est_net === null && noCost.needs_attention && /maliyeti bilinmiyor/.test(noCost.attention_reason ?? ""), noCost);
const cancelled = orderRow("trendyol", { ...o, status: "Cancelled" }, refs, cfg);
check("satır: iptalde kâr yok", cancelled.status === "cancelled" && cancelled.est_net === null, cancelled);
const two = orderRow("trendyol", { ...o, total: 918, lines: [{ ...o.lines[0], qty: 2 }] }, refs, cfg);
check("satır: çok adet maliyeti adetle çarpar", two.est_cost === 236.66 && two.units === 2, two);

// Kâr kalemleri (satış raporu)
const f = r.fin!;
check("kalem: net = gelir - komisyon - kargo - sabit - maliyet - KDV farkı", Math.abs(Number(f.revenue) - Number(f.commission) - Number(f.shipping) - Number(f.service) - Number(f.cost) - Number(f.vat_due) - Number(f.net)) < 0.02, f);
check("kalem: stopaj %1 KDV hariç satıştan, nete dahil değil", f.stopaj === Math.round(459 / 1.2 * 0.01 * 100) / 100, f);
const ret = orderRow("trendyol", { ...o, status: "Returned" }, refs, { ...cfg, returnCost: 180 });
check("iade: kayıp = iade masrafı (KDV'si indirilir), kâr eksi", ret.status === "returned" && ret.est_net === -150 && ret.fin?.return_loss === 150, ret.fin);
const actRate = orderRow("trendyol", { ...o, lines: [{ ...o.lines[0], commissionRate: 0.2 }] }, refs, cfg);
check("komisyon: pazaryerinin siparişteki oranı ilan oranından önce", actRate.lines[0].commission_rate === 0.2 && actRate.est_net === breakdown(459, 118.33, cfg, 0.2).net, actRate.lines[0]);
const late = orderRow("trendyol", { ...o, status: "Picking", deadline: Date.now() - 3600000 }, refs, cfg);
check("gecikme: kargo süresi geçen açık sipariş dikkat ister", late.needs_attention && /süresi geçti/.test(late.attention_reason ?? ""), late.attention_reason);

// Hepsiburada OMS kaydı (alan adları doğrulanmadı; iki biçim de okunur)
const h1 = hbOrder({ orderNumber: "H1", orderDate: "2026-10-22T10:00:00", merchantSku: "OS13-A", productName: "A", quantity: 2, unitPrice: { amount: 150, currency: "TRY" }, hbDiscount: { totalPrice: { amount: 10 } }, customerName: "Ad", shippingAddress: { address: "Sk 1", district: "Kadıköy", city: "İstanbul" }, id: "L1" }, "Open")!;
check("HB: satır biçimi (tutar nesnesi, ad/adres)", h1.packageId === "H1" && h1.total === 300 && h1.lines[0].qty === 2 && h1.lines[0].tyDiscount === 10 && h1.customer?.address?.district === "Kadıköy" && h1.status === "Open", h1);
const h2 = hbOrder({ packageNumber: "PK9", status: "Packaged", items: [{ orderNumber: "H1", merchantSku: "OS13-A", quantity: 2, price: 150, id: "L1" }], cargoCompany: "hepsiJET", barcode: "HJ123" }, "Packaged")!;
const mm = new Map(); mergeOrder(mm, h1); mergeOrder(mm, h2);
const m1 = mm.get("H1");
check("HB: aynı sipariş açık + paketli listede tek kayıt, son durum ve kargo kodu", mm.size === 1 && m1.status === "Packaged" && m1.lines.length === 1 && m1.tracking === "HJ123" && m1.customer.name === "Ad", m1);
check("durum: HB Packaged -> ready, Cancelled -> cancelled", mapOrderStatus("hepsiburada", "Packaged").status === "ready" && mapOrderStatus("hepsiburada", "CancelledByMerchant").status === "cancelled");

if (fails) { console.log(`\n${fails} sipariş testi başarısız`); process.exit(1); }
console.log("\nSipariş testleri geçti");
