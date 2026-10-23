// Doldurulamayan zorunlu özelliklerin seçenekleri (pazaryerinin değer listesi): panelde toplu düzeltme ekranı
// (Pazaryeri > Özellik tamamla) bu listeden seçtirir. Adaptörler gönderim sırasında not eder, senkron sonunda attr_options'a yazılır (migration 041).
type Opt = { marketplace: string; category_id: string; name: string; values: string[]; allow_custom: boolean; category_name: string | null };
const pending = new Map<string, Opt>();

export function noteMissing(marketplace: string, categoryId: string | number, name: string, values: string[], allowCustom: boolean, categoryName?: string | null) {
  const k = `${marketplace}|${categoryId}|${name}`;
  if (pending.has(k)) return;
  pending.set(k, { marketplace, category_id: String(categoryId), name, values: [...new Set(values.filter(Boolean))].slice(0, 1000), allow_custom: allowCustom, category_name: categoryName ?? null });
}

export async function flushAttrOptions(db: any) {
  const rows = [...pending.values()].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  pending.clear();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("attr_options").upsert(rows.slice(i, i + 200), { onConflict: "marketplace,category_id,name" });
    if (error) return { error: error.message.slice(0, 200) };
  }
  return { saved: rows.length };
}
