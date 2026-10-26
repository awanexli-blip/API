import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad } from "@/lib/server";
import { ensureCategories, getAttrs, hbConfigured, normPath } from "@/lib/mp-catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ürün formu için pazaryeri kataloğu (lib/mp-catalog.ts, migration 055):
//   GET ?mp=trendyol|hepsiburada&q=<arama>          -> kategori arama (yaprak kategoriler, yol ile)
//   GET ?mp=...&cat=<kategori no>[&refresh=1]       -> kategorinin özellikleri (zorunlu / varyant / değer listesi)
const MPS = ["trendyol", "hepsiburada"];

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const mp = sp.get("mp") ?? "";
  if (!MPS.includes(mp)) return bad("Geçersiz pazaryeri");
  if (mp === "hepsiburada" && !hbConfigured()) {
    return NextResponse.json({ error: "Hepsiburada bağlantısı panelde tanımlı değil (Vercel: HB_MERCHANT_ID, HB_USERNAME, HB_PASSWORD, HB_ENV=prod)", code: "HB_NOT_CONFIGURED" }, { status: 409 });
  }
  const db = admin();
  try {
    const cat = (sp.get("cat") ?? "").trim();
    if (cat) {
      if (!/^[\w-]{1,40}$/.test(cat)) return bad("Geçersiz kategori");
      const attrs = await getAttrs(db, mp, cat, sp.get("refresh") === "1");
      return NextResponse.json({ marketplace: mp, category_id: cat, attrs });
    }
    const q = normPath(sp.get("q") ?? "").slice(0, 80);
    if (q.length < 2) return NextResponse.json({ items: [] });
    await ensureCategories(db, mp);
    // Önce tüm kelimeler; sonuç yoksa son kelimeler atılarak (başlıktan öneri: "Erkek Siyah Sneaker Ayakkabı 42" -> ...)
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
