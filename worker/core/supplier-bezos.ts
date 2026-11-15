// Bezos sipariş satırı çözümü (K 15.11). Bağımlılıklar dışarıdan verilir (test edilir: worker/test/supplier-resolve.test.ts).
// Sıra: (1) varyant: ürün kaydından ya da ilan barkodundan (HB satırları ürüne bağlı olmayabilir) + sipariş adındaki seçenek (resolveVariant)
//       (2) Bezos kodu: varyant barkoduyla sorgu (Bezos orijinal kodu döndürür; Türkçe karakter korunur, ör. "3DP-0053-Kırmızı")
//           -> barkodu boş Bezos varyantlarında bizim kodumuz (BZS öneki atılmış) -> ürünün orijinal kodu (source_ref)
import { resolveVariant, supplierCode, planCarrier, type VariantLite } from "./supplier-resolve.ts";

export type BezosProduct = { id: number; code: string; barcode?: string; name?: string; stock: number; unitPrice: number; walletUnitPrice?: number; vatRate?: number; carriers?: string[]; variantParentId?: number | null };
export type ResolveDeps = {
  variantsOfProduct: (productId: string) => Promise<VariantLite[]>;
  productOfBarcode: (barcode: string) => Promise<{ productId: string; sourceRef: string | null } | null>;
  sourceRefOf: (productId: string) => Promise<string | null>;
  bezos: (codeOrBarcode: string) => Promise<BezosProduct | null>;
};
export type LineIn = { listing_key: string | null; title: string | null; product_id: string | null; qty: number };
export type LineOut = { ok: true; code: string; product: BezosProduct; variant: VariantLite; by: string } | { ok: false; reason: string; candidates?: string[] };

export async function resolveBezosLine(line: LineIn, deps: ResolveDeps, prefix = "BZS"): Promise<LineOut> {
  let productId = line.product_id, sourceRef: string | null = null;
  if (!productId && line.listing_key) { const p = await deps.productOfBarcode(line.listing_key); if (p) { productId = p.productId; sourceRef = p.sourceRef; } }
  if (!productId) return { ok: false, reason: "ürün kaydı bulunamadı (ilan barkodu ürünlerde yok)" };
  const variants = await deps.variantsOfProduct(productId);
  const rv = resolveVariant(line, variants);
  if (!rv.ok) return { ok: false, reason: `varyant: ${rv.reason}`, candidates: rv.candidates };
  const tries: [string, string][] = [];
  if (rv.variant.barcode) tries.push([rv.variant.barcode, "barkod"]);
  const own = supplierCode(rv.variant.sku, prefix); if (own) tries.push([own, "kod"]);
  if (variants.length === 1) { sourceRef ??= await deps.sourceRefOf(productId); if (sourceRef) tries.push([sourceRef, "orijinal kod"]); }
  for (const [q, how] of tries) {
    const p = await deps.bezos(q);
    if (p?.code) return { ok: true, code: p.code, product: p, variant: rv.variant, by: `${rv.by}/${how}` };
  }
  return { ok: false, reason: `Bezos'ta bulunamadı (${tries.map((t) => t[0]).join(", ")})` };
}

// Sepet planı: aynı Bezos kodu birleşir (aynı ürün iki satır / adet), stok ve kargo kontrolü
export type PlanItem = { code: string; quantity: number; expectedUnitPrice: number; name?: string };
export function planBezosOrder(lines: { qty: number; res: LineOut }[], orderCargo: string | null, marketplace: string):
  { ok: boolean; items: PlanItem[]; carrier: string | null; problems: string[]; cargoChange?: { code: string; carrier: string } } {
  const problems: string[] = [];
  const byCode = new Map<string, PlanItem & { stock: number; carriers: string[] }>();
  for (const l of lines) {
    if (!l.res.ok) { problems.push(l.res.reason); continue; }
    const p = l.res.product, cur = byCode.get(p.code);
    if (cur) cur.quantity += l.qty;
    else byCode.set(p.code, { code: p.code, quantity: l.qty, expectedUnitPrice: Number(p.unitPrice), name: p.name, stock: Number(p.stock), carriers: p.carriers ?? [] });
  }
  for (const it of byCode.values()) if (it.stock < it.quantity) problems.push(`${it.code}: Bezos stoğu ${it.stock}, gereken ${it.quantity}`);
  // Kargo: tüm kalemlerin ortak gönderebildiği firma
  const all = [...byCode.values()];
  const common = all.length ? all.map((x) => x.carriers).reduce((a, b) => a.filter((c) => b.some((d) => d.toLocaleLowerCase("tr") === c.toLocaleLowerCase("tr")))) : [];
  let carrier: string | null = null, cargoChange: { code: string; carrier: string } | undefined;
  if (all.length) {
    const pc = planCarrier(orderCargo, common, marketplace);
    if (pc.ok) carrier = pc.carrier; else { problems.push(`kargo: ${pc.reason}`); cargoChange = pc.change; }
  }
  return { ok: !problems.length && all.length > 0, items: all.map(({ stock, carriers, ...x }) => x), carrier, problems, cargoChange };
}
