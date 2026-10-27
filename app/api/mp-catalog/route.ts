import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad } from "@/lib/server";
import { cachedAttrs, ensureCategories, getAttrs, hasCategories, hbConfigured, normPath } from "@/lib/mp-catalog";
import { dispatchWorkflow } from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ürün formu için pazaryeri kataloğu (lib/mp-catalog.ts, migration 055):
//   GET ?mp=trendyol|hepsiburada&q=<arama>          -> kategori arama (yaprak kategoriler, yol ile)
//   GET ?mp=...&cat=<kategori no>[&refresh=1]       -> kategorinin özellikleri (zorunlu / varyant / değer listesi)
// Hepsiburada anahtarı panelde (Vercel) yoksa: önbellekten; yoksa iş kuyruğuna yazılır, "Pazaryeri kataloğu" iş akışı (GitHub) çeker
// -> { pending: true }; form birkaç saniyede bir tekrar sorar.
const MPS = ["trendyol", "hepsiburada"];

// Aynı istek kuyrukta bekliyorsa iş akışı yeniden başlatılmaz
async function queue(db: any, mp: string, cid: string | null) {
  const type = cid ? `mp_attrs:${mp}` : `mp_cats:${mp}`;
  const { data: open } = await db.from("jobs").select("id").eq("type", type).in("status", ["queued", "running"]).contains("payload", cid ? { category_id: cid } : {}).limit(1);
  if (!open?.length && cid) await db.from("jobs").insert({ type, marketplace: mp, payload: { category_id: cid }, idempotency_key: `${type}:${cid}:${new Date().toISOString().slice(0, 15)}`, created_by: "urun-formu" });
  if (open?.length) return { started: true };
  const r = await dispatchWorkflow("catalog.yml");
  return { started: r.ok, error: r.error };
}

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const mp = sp.get("mp") ?? "";
  if (!MPS.includes(mp)) return bad("Geçersiz pazaryeri");
  const db = admin();
  const live = mp === "trendyol" || hbConfigured();
  try {
    const cat = (sp.get("cat") ?? "").trim();
    if (cat) {
      if (!/^[\w-]{1,40}$/.test(cat)) return bad("Geçersiz kategori");
      if (live) return NextResponse.json({ marketplace: mp, category_id: cat, attrs: await getAttrs(db, mp, cat, sp.get("refresh") === "1") });
      const c = await cachedAttrs(db, mp, cat);
      if (c && !c.stale && sp.get("refresh") !== "1") return NextResponse.json({ marketplace: mp, category_id: cat, attrs: c.attrs });
      const q = await queue(db, mp, cat);
      if (c) return NextResponse.json({ marketplace: mp, category_id: cat, attrs: c.attrs, refreshing: true }); // eskisi gösterilir, arkada tazelenir
      return NextResponse.json({ pending: true, started: q.started, error: q.error ?? null });
    }
    const q = normPath(sp.get("q") ?? "").slice(0, 80);
    if (q.length < 2) return NextResponse.json({ items: [] });
    if (live) await ensureCategories(db, mp);
    else if (!(await hasCategories(db, mp))) { const r = await queue(db, mp, null); return NextResponse.json({ items: [], pending: true, started: r.started, error: r.error ?? null }); }
    // Önce tüm kelimeler; sonuç yoksa birer kelime atılarak (başlıktan öneri: "Erkek Siyah Sneaker Ayakkabı 42" -> ...)
    const words = q.split(" ").filter((w) => w.length >= 2).slice(0, 6);
    for (let n = words.length; n >= 1; n--) {
      const tries = n === words.length ? [words] : words.map((_, i) => words.filter((__, j) => j !== i)).filter((w) => w.length === n).slice(0, 6);
      for (const w of tries) {
        const { data, error } = await db.rpc("mp_category_search", { p_mp: mp, p_q: w.join(" "), p_limit: 15 });
        if (error) return bad(error.message);
        if (data?.length) return NextResponse.json({ items: data });
      }
      if (n <= Math.max(1, words.length - 2)) break;
    }
    return NextResponse.json({ items: [] });
  } catch (e: any) {
    return NextResponse.json({ error: `Pazaryerinden okunamadı: ${String(e?.message ?? e).slice(0, 300)}` }, { status: 502 });
  }
}
