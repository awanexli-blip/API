// Açıklaması eksik/çok kısa ürünlere başlıktan kurallı TASLAK (K, 10.11: "%80 emin olduklarını düzelt"). Yapay zekâ ve dış kaynak yok: yalnızca üründe yazan bilgi yeniden düzenlenir.
// Taslak panelde "Açıklamalar > onay bekleyen" listesine düşer; K onaylamadan pazaryerine gitmez.
//   node --experimental-strip-types worker/desc-fill.ts          yazmaz, sayar
//   node --experimental-strip-types worker/desc-fill.ts --apply  product_descriptions'a yazar (var olana dokunmaz)
// Sunucu veritabanı için trentakip-vps ile. Müşteri verisi okumaz.
import { createClient } from "@supabase/supabase-js";
import { env, chunk } from "./core/util.ts";
import { phoneModelOf } from "./core/attr-infer.ts";

const apply = process.argv.includes("--apply");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const clean = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const COLORS = ["siyah", "beyaz", "gri", "mavi", "lacivert", "kırmızı", "yeşil", "sarı", "turuncu", "mor", "pembe", "gold", "gümüş", "bronz", "kahverengi", "bej", "şeffaf"];
const low = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
const up = (s: string) => s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);

export function draftFromTitle(title: string, category: string): string | null {
  const t = clean(title), leaf = clean(String(category).split(/>{1,3}/).pop());
  if (t.length < 12 || !leaf) return null;
  // Renk yalnızca parantez içinde ya da başlığın son kelimesiyse yazılır: "Mavi Işık Filtreli", "Siyah Nokta" gibi başlıklar renk değildir.
  const model = phoneModelOf(t), lt = low(t), inParen = (lt.match(/\(([^)]*)\)/g) ?? []).join(" ").replace(/[()\-,/]/g, " "), lastWord = lt.replace(/[()\-,/.]/g, " ").trim().split(/\s+/).pop() ?? "";
  const color = COLORS.find((c) => ` ${inParen} `.includes(` ${c} `) || lastWord === c);
  const lines = [`${t}.`, `Ürün türü: ${leaf}.`];
  if (model) lines.push(`Uyumlu olduğu model: ${model}.`);
  if (color) lines.push(`Renk: ${up(color)}.`);
  lines.push("Satın almadan önce başlıktaki model ve özelliklerin ihtiyacınıza uygun olduğunu kontrol ediniz.");
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("desc-fill.ts")) {
  const out: any[] = []; const by = new Map<string, number>();
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db.from("products").select("id, title, description, category, source, product_variants(stock, reserved)").gt("id", last).eq("status", "active").order("id").limit(1000);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    last = (data[data.length - 1] as any).id;
    for (const p of data as any[]) {
      if (clean(p.description).length >= 40) continue;
      if (!(p.product_variants ?? []).some((v: any) => Number(v.stock ?? 0) - Number(v.reserved ?? 0) > 0)) continue;
      const draft = draftFromTitle(p.title, p.category);
      if (!draft) continue;
      out.push({ product_id: p.id, status: "ready", draft, original: String(p.description ?? ""), reason: "Açıklama eksikti: ürün başlığından kurallı taslak", model: "kural-baslik", checks: {}, updated_at: new Date().toISOString() });
      const k = clean(String(p.category).split(/>{1,3}/).pop()); by.set(k, (by.get(k) ?? 0) + 1);
    }
  }
  const have = new Set<string>();
  for (const part of chunk(out.map((x) => x.product_id), 150)) { const { data, error } = await db.from("product_descriptions").select("product_id").in("product_id", part); if (error) throw new Error(error.message); for (const r of data ?? []) have.add((r as any).product_id); }
  const fresh = out.filter((x) => !have.has(x.product_id));
  console.log(JSON.stringify({ eksik: out.length, zatenTaslakli: have.size, yazilacak: fresh.length, deneme: !apply }));
  console.log([...by].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${n} ${k}`).join(" | "));
  console.log(fresh.slice(0, 3).map((x) => x.draft.replace(/\n/g, " / ")).join("\n"));
  if (apply) { let n = 0; for (const part of chunk(fresh, 200)) { const { error } = await db.from("product_descriptions").insert(part); if (error) throw new Error(error.message); n += part.length; } console.log(JSON.stringify({ yazilan: n })); }
}
