// Hepsiburada kategori eşlemesi (K, 10.11: "stoktaki ürünler Hepsiburada'ya eklenemiyor"; 46 bin üründe neden category_map'in boş olmasıydı).
// Otomatik eşleştirici yanlış seçiyordu (Tasarım Kupa -> Reçel, Telefon Kılıfı -> Kapak): aşağıdaki liste ELLE seçildi, yalnızca tek anlamlı yollar.
// Belirsiz yollar (ör. düz "Oyuncak", "Diğer Oyuncaklar", dijital ürünler) bilerek yok: öylece "kategori yok" kalır, yanlış kategoriye gitmez.
//   node --experimental-strip-types worker/hb-map.ts             yazmaz: hangi yol hangi kategoriye, kaç ürün
//   node --experimental-strip-types worker/hb-map.ts --apply     category_map'e yazar (var olan elle girilmiş eşlemeye dokunmaz)
// Sunucu veritabanı için trentakip-vps ile çalıştırılır.
import { createClient } from "@supabase/supabase-js";
import { env, readAll, chunk } from "./core/util.ts";

const apply = process.argv.includes("--apply");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// [son adım deseni, hepsiburada kategori no, üst yol şartı]
type Rule = [RegExp, string, RegExp?];
const PHONE = /telefon|cep telefon|gsm/i, TABLET = /tablet/i;
export const RULES: Rule[] = [
  [/^tablet ekran koruyucu/i, "60001212"],
  [/^telefon kılıfı$/i, "16102"],
  [/^(telefon )?ekran koruyucu$/i, "80315023", PHONE],
  [/^ekran ve dokunmatik parçaları$/i, "60007724"],
  [/^(arka kapaklar|kasalar ve orta çerçeveler)$/i, "60007726"],
  [/^(telefon tuşları ve tuş flexleri|bağlantı ve anten flexleri)$/i, "60007733"],
  [/^(kamera modülleri|yedek kamera camları)$/i, "60007731"],
  [/^şarj soketleri ve şarj flexleri$/i, "60007732"],
  [/^telefon bataryaları$/i, "16111"],
  [/^(sim kart tepsileri|kamera lens koruyucu)$/i, "60002300", PHONE],
  [/^saat aksesuarları$/i, "375468", PHONE],
  [/^airpods aksesuarları$/i, "80413102"],
  [/^kablolar$/i, "29010123", PHONE],
  [/^kablolu şarj$/i, "16113", PHONE],
  [/^akıllı saat(ler)?$/i, "60003676"],
  [/^(bijuteri )?küpe$/i, "60001608"],
  [/^(bijuteri )?kolye$/i, "60001609"],
  [/^(bayan bileklik|bijuteri bileklik|charm bileklikler)$/i, "60001611"],
  [/^(bayan yüzük ve kombinler|bijuteri yüzük)$/i, "60001620"],
  [/^anahtarlık$/i, "18103"],
  [/^(oyuncak arabalar|mini araclar|oyuncak araçlar)$/i, "60006677"],
  [/^(figür ve sürpriz oyuncaklar|diğer figür oyuncaklar|figür oyuncaklar)$/i, "80138072"],
  [/^(pelus oyuncaklar|peluş oyuncak)$/i, "23020733"],
  [/^puzzle ve yapi oyuncaklari$/i, "297986"],
  [/^(egitici oyuncaklar|eğitici oyuncak)$/i, "60002385"],
  [/^(oyun setleri|kiz ve erkek oyun setleri)$/i, "23022181"],
  [/^oyuncak bebekler ve aksesuarları$/i, "60006479"],
  [/^bebek & okul öncesi oyuncaklar$/i, "303251"],
  [/^kaseler$/i, "80327170"],
  [/^tasarım kupalar$/i, "22351"],
  [/^masaj cihazı$/i, "26012186"],
  [/^vantilatör$/i, "17412"],
  [/^saç maşası$/i, "26012129"],
  [/^yetişkin kedi kuru mamaları$/i, "60000543"],
  [/^yetişkin kedi konservesi$/i, "60006985"],
  [/^köpek ödülleri$/i, "24001767"],
  [/^(parti taç çeşitleri|parti aksesuarı)$/i, "23010454"],
  [/^parti kostümü$/i, "1205176"],
  [/^masa ve gece lambası$/i, "13003235"],
];
void TABLET;
export function ruleFor(path: string): Rule | null {
  const segs = String(path ?? "").split(/>{1,3}/).map((s) => s.trim()).filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  return RULES.find(([re, , up]) => re.test(last) && (!up || up.test(segs.slice(0, -1).join(" ")) || up.test(last))) ?? null;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("hb-map.ts")) {
  const counts = new Map<string, { n: number; ex: string[] }>();
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db.from("products").select("id, category, title").gt("id", last).eq("status", "active").order("id").limit(1000);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    last = (data[data.length - 1] as any).id;
    for (const p of data as any[]) { const c = String(p.category ?? ""); const g = counts.get(c) ?? { n: 0, ex: [] }; g.n++; if (g.ex.length < 2) g.ex.push(String(p.title).slice(0, 50)); counts.set(c, g); }
  }
  const cats = await readAll<any>((a, b) => db.from("mp_categories").select("id, name, path").eq("marketplace", "hepsiburada").order("id").range(a, b));
  if (cats.error) throw new Error(cats.error.message);
  const byId = new Map<string, any>(cats.data.map((c: any) => [String(c.id), c]));
  for (const [, id] of RULES) if (!byId.has(id)) throw new Error(`Hepsiburada ağacında yok: ${id}`);
  const cur = await readAll<any>((a, b) => db.from("category_map").select("xml_category").eq("marketplace", "hepsiburada").order("xml_category").range(a, b));
  if (cur.error) throw new Error(cur.error.message);
  const have = new Set(cur.data.map((r: any) => r.xml_category));
  const rows: any[] = []; let products = 0; const summary = new Map<string, number>();
  for (const [c, g] of counts) {
    const r = ruleFor(c); if (!r || have.has(c)) continue;
    const name = String(byId.get(r[1]).name);
    rows.push({ marketplace: "hepsiburada", xml_category: c, category_id: Number(r[1]), category_name: name });
    products += g.n; summary.set(`${name} [${r[1]}]`, (summary.get(`${name} [${r[1]}]`) ?? 0) + g.n);
  }
  console.log(JSON.stringify({ aktifYol: counts.size, eslesenYol: rows.length, aktifUrun: products, zatenVar: have.size, deneme: !apply }));
  for (const [k, n] of [...summary].sort((a, b) => b[1] - a[1])) console.log(n, k);
  if (apply) {
    for (const part of chunk(rows, 500)) { const { error } = await db.from("category_map").upsert(part, { onConflict: "marketplace,xml_category" }); if (error) throw new Error(error.message); }
    console.log(JSON.stringify({ yazilan: rows.length }));
  }
}
