// Varyant (renk) görsellerini yaz (migration 063): product_save bu kolona dokunmaz; ürün kaydedildikten sonra varyant SKU'suyla güncellenir.
// Aynı görsel listesine sahip varyantlar tek sorguda.
export async function saveVariantImages(db: any, productId: string, variants: { sku: string; images?: string[] }[]) {
  const groups = new Map<string, string[]>();
  for (const v of variants) { const k = JSON.stringify((v.images ?? []).slice(0, 8)); groups.set(k, [...(groups.get(k) ?? []), v.sku]); }
  for (const [k, skus] of groups) {
    const { error } = await db.from("product_variants").update({ images: JSON.parse(k) }).eq("product_id", productId).in("sku", skus);
    if (error) return error;
  }
  return null;
}
