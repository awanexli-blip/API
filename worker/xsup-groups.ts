// Tedarikçiler arası ürün eşleştirme (K 28.11, migration 104; saf mantık worker/core/xsup.ts). Pazaryerine HİÇBİR ŞEY yazmaz.
//   node --experimental-strip-types worker/xsup-groups.ts candidates [--dry]   # imzası >=2 tedarikçide geçen ve pazaryerinde ilanı olan kovalar -> product_xkeys (görsel özeti bekleyenler)
//   (K'nın bilgisayarı)  python ops/xsup/hash_images.py                         # bekleyenlerin ilk görselini indirir, pHash+dHash yazar
//   node --experimental-strip-types worker/xsup-groups.ts group [--dry]        # sıkı eşleşme -> product_xgroups (tek işlemde yenilenir)
// Ortam: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (sunucu veritabanı). Ağır iş: /run/lock/trentakip-heavy.lock altında çalıştır.
import { createClient } from "@supabase/supabase-js";
import { env, chunk } from "./core/util.ts";
import { buildGroups, candidates, isGtin, type XMember } from "./core/xsup.ts";

const mode = process.argv[2] ?? "";
const dry = process.argv.includes("--dry");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function members(): Promise<XMember[]> {
  const out: XMember[] = [];
  for (let after: string | null = null; ; ) {
    let res: any;
    for (let t = 1; ; t++) {
      res = await db.rpc("xsup_members", { p_after: after, p_limit: 3000 });
      if (!res.error || t >= 3) break;
      await new Promise((r) => setTimeout(r, 3000 * t));
    }
    if (res.error) throw new Error(`xsup_members okunamadı: ${res.error.message}`);
    const rows = res.data as any[];
    for (const r of rows) out.push({ id: r.id, source: r.source, sku: r.sku, title: r.title, gtin: isGtin(r.gtin) ? r.gtin : null, ph: r.ph, dh: r.dh, img_url: r.img_url, live: r.live ?? [] });
    if (rows.length < 3000) break;
    after = rows[rows.length - 1].id;
  }
  return out;
}

async function main() {
  if (mode !== "candidates" && mode !== "group") throw new Error("kullanım: xsup-groups.ts candidates|group [--dry]");
  const ms = await members();
  console.log(JSON.stringify({ members: ms.length, sources: [...new Set(ms.map((m) => m.source))].length }));
  if (mode === "candidates") {
    const c = candidates(ms);
    const noImg = c.filter((x) => !x.img_url).length;
    const hashed = new Set(ms.filter((m) => m.ph && m.dh).map((m) => m.id));
    const pending = c.filter((x) => x.img_url && !hashed.has(x.id)).length;
    console.log(JSON.stringify({ candidates: c.length, noImage: noImg, hashPending: pending }));
    if (dry) return;
    for (const part of chunk(c.filter((x) => x.img_url), 1000)) {
      const r = await db.from("product_xkeys").upsert(part.map((x) => ({ product_id: x.id, sig: x.sig, img_url: x.img_url, updated_at: new Date().toISOString() })), { onConflict: "product_id" });
      if (r.error) throw new Error(`product_xkeys yazılamadı: ${r.error.message}`);
    }
    console.log("product_xkeys güncellendi");
    return;
  }
  // group: yalnızca görsel özeti olanlar ya da gerçek barkodu başka tedarikçide de geçenler
  const gt = new Map<string, Set<string>>();
  for (const m of ms) if (m.gtin) (gt.get(m.gtin) ?? gt.set(m.gtin, new Set()).get(m.gtin)!).add(m.source);
  const pool = ms.filter((m) => (m.ph && m.dh) || (m.gtin && (gt.get(m.gtin)?.size ?? 0) > 1));
  const g = buildGroups(pool);
  const byMethod: Record<string, number> = {};
  const keys = new Set(g.map((x) => x.group_key));
  for (const x of g) byMethod[x.method] = (byMethod[x.method] ?? 0) + 1;
  console.log(JSON.stringify({ pool: pool.length, groups: keys.size, members: g.length, byMethod }));
  if (dry) return;
  const r = await db.rpc("xsup_replace_groups", { p_rows: g });
  if (r.error) throw new Error(`product_xgroups yazılamadı: ${r.error.message}`);
  console.log(JSON.stringify({ changedRows: r.data }));
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
