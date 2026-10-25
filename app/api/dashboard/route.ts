import { NextRequest, NextResponse } from "next/server";
import { admin, MARKETPLACES } from "@/lib/server";
import { authorize } from "@/lib/products";

export const dynamic = "force-dynamic";

type Alert = { level: "bad" | "warn" | "info" | "ok"; text: string; go?: string };
const minsAgo = (s?: string | null) => (s ? Math.round((Date.now() - new Date(s).getTime()) / 60000) : Infinity);

// Gösterge paneli: sayılar, son çalışmalar, uyarılar. Pazaryeri/tedarikçi bilgileri yalnızca yöneticiye.
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const db = admin();
  const isAdmin = a.role === "admin";
  const count = async (q: any) => (await q).count ?? 0;

  // Sayımlar tek sorguda (migration 043; önceden 10 ayrı tam sayım, marka tablosu 800 bin satır)
  const [cnt, jobs] = await Promise.all([
    db.rpc("dashboard_counts"),
    db.from("import_jobs").select("id, kind, source, supplier, status, total, created, updated, stock_only, failed, message, started_at, finished_at").order("id", { ascending: false }).limit(6),
  ]);
  const c: any = cnt.data ?? {};
  const total = Number(c.products ?? 0);
  const out: any = { products: { total, active: Number(c.active ?? 0), variants: Number(c.variants ?? 0), inStockVariants: Number(c.in_stock_variants ?? 0) }, imports: jobs.data ?? [], alerts: [] as Alert[] };
  const alerts: Alert[] = out.alerts;
  if (!total) alerts.push({ level: "info", text: "Ürün veritabanı boş. Tedarikçiler bölümünden XML içe aktar veya ürün ekle.", go: isAdmin ? "tedarikciler" : "urunler" });
  const lastJob = out.imports[0];
  if (lastJob?.status === "error") alerts.push({ level: "bad", text: `Son içe aktarma hata verdi: ${lastJob.message ?? ""}`.trim(), go: "ice-aktar" });
  if (lastJob?.status === "running" && minsAgo(lastJob.started_at) > 90) alerts.push({ level: "warn", text: "Bir içe aktarma 90 dakikadan uzun süredir 'sürüyor' görünüyor (GitHub Actions'ta yarıda kalmış olabilir).", go: "ice-aktar" });

  if (!isAdmin) return NextResponse.json(out);

  // Kampanya adayları ("3 al 2 öde", "2. ürüne indirim"): Trendyol'da satışta, alışı 150 TL altı, stoğu 20+ (çoklu adet koruması kârı korur)
  if (req.nextUrl.searchParams.get("campaign") === "1") {
    const rows: any[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await db.from("marketplace_listings").select("listing_key, title, price, products!inner(cost_price, status), product_variants!inner(stock)")
        .eq("marketplace", "trendyol").eq("status", "live").lt("products.cost_price", 150).eq("products.status", "active").gte("product_variants.stock", 20).range(from, from + 999);
      if (error) return NextResponse.json({ error: "Liste alınamadı" }, { status: 500 });
      rows.push(...(data ?? []).map((r: any) => ({ barcode: r.listing_key, title: r.title, price: r.price, cost: r.products?.cost_price, stock: r.product_variants?.stock })));
      if ((data ?? []).length < 1000) break;
    }
    return NextResponse.json(rows);
  }

  const brands = Number(c.brands ?? 0);
  const [settings, runs, suppliers, unmapped, rules] = await Promise.all([
    db.from("settings").select("auto_sync, auto_create, existing_price_policy, zero_missing").eq("id", 1).maybeSingle(),
    db.from("sync_runs").select("id, marketplace, mode, status, started_at, finished_at, summary").order("id", { ascending: false }).limit(40),
    db.from("suppliers").select("code, name, active, nightly, last_run_at, last_status").order("created_at"),
    db.from("unmapped_categories").select("product_count").eq("marketplace", "trendyol"),
    count(db.from("pricing_rules").select("id", { count: "exact", head: true }).eq("enabled", true)),
  ]);
  const s = settings.data;
  const allRuns = (runs.data ?? []) as any[];
  // Pazaryeri başına son çalışma (atlananlar hariç) ve son "gerçek" güncelleme
  out.markets = MARKETPLACES.map((m) => {
    const mine = allRuns.filter((r) => (r.marketplace ?? r.summary?.marketplace ?? "trendyol") === m);
    const last = mine.find((r) => r.status !== "skipped") ?? mine[0] ?? null;
    const sm = last?.summary ?? {};
    return {
      id: m, last: last && { id: last.id, mode: last.mode, status: last.status, started_at: last.started_at, finished_at: last.finished_at },
      listings: sm.listings ?? null, matched: sm.matched ?? null, updated: sm.updated ?? null, created: sm.created ?? null, failedBatches: sm.failedBatches ?? 0,
      skippedRun: mine[0]?.status === "skipped" ? mine[0]?.summary?.skippedRun ?? null : null,
      rejected: sm.newProductApproval?.rejected ?? 0, pendingApproval: sm.newProductApproval?.pendingApproval ?? 0,
    };
  });
  // Faz 3 ilan tablosu: Trendyol'daki ilanların durumu ve ürün veritabanına bağlı olanlar
  const l = c.listings ?? {};
  out.listings = { live: Number(l.live ?? 0), pending: Number(l.pending ?? 0), closed: Number(l.closed ?? 0), linked: Number(l.linked ?? 0) };
  out.timeline = allRuns.slice(0, 10).map((r) => ({ id: r.id, marketplace: r.marketplace ?? r.summary?.marketplace ?? "trendyol", mode: r.mode, status: r.status, started_at: r.started_at, updated: r.summary?.updated, created: r.summary?.created, skippedRun: r.summary?.skippedRun }));
  out.suppliers = suppliers.data ?? [];
  out.settings = s;
  out.pricingRules = rules;
  // Günlük satış (sales_daily, son 35 gün; tablo yoksa boş)
  const sales = await db.from("sales_daily").select("marketplace, day, orders, units, revenue, cancelled, returns").gte("day", new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10)).order("day");
  out.sales = sales.error ? [] : sales.data ?? [];

  const ty = out.markets.find((m: any) => m.id === "trendyol");
  if (s && !s.auto_sync) alerts.push({ level: "warn", text: "Otomatik stok/fiyat senkronu duraklatılmış.", go: "pazaryeri/trendyol/ozet" });
  if (ty?.last?.status === "error") alerts.push({ level: "bad", text: "Son Trendyol senkronu hata verdi.", go: "pazaryeri/trendyol/ozet" });
  else if (ty?.last?.status === "partial" || ty?.failedBatches > 0) alerts.push({ level: "warn", text: `Son Trendyol senkronunda başarısız toplu istek var (${ty.failedBatches}).`, go: "pazaryeri/trendyol/ozet" });
  if (s?.auto_sync && minsAgo(ty?.last?.started_at) > 60) alerts.push({ level: "warn", text: `Son Trendyol senkronu ${Number.isFinite(minsAgo(ty?.last?.started_at)) ? `${minsAgo(ty?.last?.started_at)} dk` : "uzun süre"} önce. 15 dakikada bir çalışması gerekirdi (GitHub Actions kotası veya zamanlayıcı?).`, go: "pazaryeri/trendyol/ozet" });
  if (ty?.rejected > 0) alerts.push({ level: "warn", text: `Trendyol ${ty.rejected} yeni ürünü reddetti. Nedenler Özet sekmesinde.`, go: "pazaryeri/trendyol/ozet" });
  const waiting = (unmapped.data ?? []).reduce((t: number, u: any) => t + (u.product_count ?? 0), 0);
  if (waiting > 0) alerts.push({ level: "info", text: `${waiting.toLocaleString("tr-TR")} yeni ürün kategori eşleşmesi bekliyor.`, go: "pazaryeri/trendyol/kategoriler" });
  for (const sp of out.suppliers) if (sp.active && sp.last_status === "error") alerts.push({ level: "bad", text: `${sp.name} XML içe aktarması hata verdi.`, go: "tedarikciler" });
  // Marka listesi bilerek tutulmuyor (25.10, veritabanı alanı): uyarı verilmez
  if (!rules) alerts.push({ level: "info", text: "Akıllı kâr kuralı yok: tüm ürünlerde tek kâr oranı kullanılıyor. Önerilen kademeli kuralları dene.", go: "pazaryeri/trendyol/kar" });
  const missing = ["GH_TOKEN", "GH_REPO", "ADMIN_EMAIL"].filter((k) => !process.env[k]);
  if (missing.length) alerts.push({ level: "bad", text: `Vercel ortam değişkeni eksik: ${missing.join(", ")}. Panel düğmeleri çalışmaz.`, go: "ayarlar" });
  if (!alerts.some((x) => x.level === "bad" || x.level === "warn")) alerts.unshift({ level: "ok", text: "Kritik sorun yok." });
  return NextResponse.json(out);
}
