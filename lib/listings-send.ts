import { createHash } from "crypto";
import { admin, MARKETPLACES, type Actor } from "@/lib/server";

const UUID = /^[0-9a-f-]{36}$/i;
// worker/core/db-products.ts listingKeyOf ile aynı: BayilikXML ürünleri "OS13-" + SKU, diğerleri varyant barkodu
// Amazon: SKU = varyant SKU'su (worker/marketplaces/amazon.ts listingKeyFor)
const keyOf = (source: string, v: { sku: string; barcode: string | null }, mp: string) => (mp === "amazon" ? v.sku : source === "xml:bayilik" ? `OS13-${v.sku}` : v.barcode ?? "");
const fail = (error: string, status = 400) => ({ status, body: { error } as any });
const dbFail = (e: { code?: string; message?: string }) => { console.error("db hatası", e.code ?? "", (e.message ?? "").slice(0, 300)); return fail(`Veritabanı hatası${e.code ? ` (${e.code})` : ""}`, 500); };

// "Pazaryerine gönder" ortak mantığı (API rotası ve Amazon toplu eşleştirme aynı yolu kullanır; dahili HTTP çağrısı yok)
// Ürünler kuyruğa (jobs: send_products:<pazaryeri>) ve ilan tablosuna "sırada" olarak yazılır; gönderimi bir sonraki senkron yapar.
// now: true -> senkron hemen başlatılır (GitHub Actions, mod "update").
export async function queueSend(a: Actor, b: { product_ids?: unknown; marketplace?: unknown; now?: unknown }): Promise<{ status: number; body: any }> {
  const marketplace = String(b.marketplace ?? "trendyol");
  if (!MARKETPLACES.includes(marketplace)) return fail("Geçersiz pazaryeri");
  if (marketplace !== "trendyol") {
    const { data: ms } = await admin().from("marketplace_settings").select("enabled").eq("marketplace", marketplace).maybeSingle();
    if (!ms?.enabled) return fail(marketplace === "amazon"
      ? "Amazon kapalı: kimlik bilgilerini girip Amazon → Fiyat ayarları'ndan aç (docs/AMAZON_KURULUM.md)"
      : "Hepsiburada kapalı: Hepsiburada → Fiyat ayarları'ndan aç");
  }
  const ids: string[] = [...new Set<string>((Array.isArray(b.product_ids) ? b.product_ids : []).filter((x: unknown) => typeof x === "string" && UUID.test(x)))];
  if (!ids.length || ids.length > 200) return fail("1-200 ürün seç");

  const db = admin();
  const { data: products, error } = await db.from("products").select("id, title, status, source, product_variants(id, sku, barcode)").in("id", ids);
  if (error) return dbFail(error);
  const now = new Date().toISOString();
  const rows: any[] = [];
  const problems: string[] = [];
  for (const p of products ?? []) {
    if (p.status !== "active") { problems.push(`${p.title}: aktif değil`); continue; }
    for (const v of p.product_variants ?? []) {
      const key = keyOf(p.source, v, marketplace);
      if (!key) { problems.push(`${p.title}: barkod yok`); continue; }
      rows.push({ marketplace, listing_key: key, variant_id: v.id, product_id: p.id, status: "queued", title: p.title, last_error: null, updated_at: now });
    }
  }
  // Zaten yayında / onay bekleyen / gönderilmiş ilanlar yeniden sıraya alınmaz
  if (rows.length) {
    const { data: ex } = await db.from("marketplace_listings").select("listing_key, status").eq("marketplace", marketplace).in("listing_key", rows.map((r) => r.listing_key));
    const busy = new Map((ex ?? []).filter((x: any) => ["live", "pending_approval", "sent", "queued"].includes(x.status)).map((x: any) => [x.listing_key, x.status]));
    for (const r of [...rows]) if (busy.has(r.listing_key)) { problems.push(`${r.title}: zaten ${busy.get(r.listing_key) === "live" ? "yayında" : busy.get(r.listing_key) === "pending_approval" ? "onay bekliyor" : "sırada"}`); rows.splice(rows.indexOf(r), 1); }
  }
  const sendIds = [...new Set(rows.map((r) => r.product_id))];
  if (!sendIds.length) return fail(problems.length ? `Gönderilecek ürün yok: ${problems.slice(0, 5).join("; ")}` : "Gönderilecek ürün yok");

  const { error: le } = await db.from("marketplace_listings").upsert(rows, { onConflict: "marketplace,listing_key" });
  if (le) return dbFail(le);
  // Aynı ürünler aynı saatte iki kez sıraya girmesin (çift tıklama)
  const hash = createHash("sha1").update(sendIds.sort().join(",")).digest("hex").slice(0, 16);
  const idem = `send:${marketplace}:${hash}:${now.slice(0, 13)}`;
  const { data: job, error: je } = await db.from("jobs").insert({ type: `send_products:${marketplace}`, marketplace, payload: { product_ids: sendIds }, idempotency_key: idem, created_by: a.email }).select("id").single();
  if (je && je.code !== "23505") return dbFail(je);

  let started = false, startError: string | null = null;
  if (b.now && a.role === "admin" && process.env.GH_TOKEN && process.env.GH_REPO) {
    const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/sync.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { mode: "update", marketplace } }),
    });
    started = r.status === 204;
    if (!started) startError = `GitHub ${r.status}`;
  }
  return { status: 200, body: { ok: true, job_id: job?.id ?? null, duplicate: je?.code === "23505", queued: rows.length, products: sendIds.length, problems, started, startError } };
}
