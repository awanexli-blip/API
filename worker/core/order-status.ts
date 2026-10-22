// Pazaryeri sipariş durumu -> iç durum (docs/FAZ6_PLAN.md diyagramı). Bilinmeyen durum asla yutulmaz: "problem" + neden.
// Trendyol paket durumları (dokümandan, canlıda doğrulanmadı): Awaiting, Created, Picking, Invoiced, Shipped, AtCollectionPoint,
// Delivered, UnDelivered, Returned, Cancelled, UnSupplied, Repack, UnPacked.
export type OrderStatus = "new" | "ready" | "sent_to_supplier" | "shipped" | "delivered" | "cancelled" | "returned" | "problem";

const MAP: Record<string, Record<string, OrderStatus>> = {
  trendyol: {
    awaiting: "new", created: "new", picking: "ready", invoiced: "ready", repack: "ready", unpacked: "ready",
    shipped: "shipped", atcollectionpoint: "shipped", delivered: "delivered",
    cancelled: "cancelled", unsupplied: "cancelled", returned: "returned", undelivered: "problem",
  },
};

export function mapOrderStatus(marketplace: string, raw: string): { status: OrderStatus; attention?: string } {
  const k = String(raw ?? "").replace(/[\s_-]/g, "").toLowerCase();
  const s = MAP[marketplace]?.[k];
  if (!s) return { status: "problem", attention: `Bilinmeyen pazaryeri durumu: "${raw}"` };
  if (s === "problem") return { status: s, attention: raw === "UnDelivered" ? "Teslim edilemedi" : `Durum: ${raw}` };
  return { status: s };
}
