// Görseli sunucuda JPEG'e çevirip kendi depomuzdan sunar (K 17.11, Hepsiburada "Görseliniz erişim problemi nedeniyle indirilememiştir").
// Neden: HB görselleri kendi sunucusundan çeker; wsrv.nl dönüştürücüsü IP başına önbelleksiz 2.500 görsel / 10 dk sınırlı ve tedarikçi
// kaynağı (bezos.com.tr) yavaş/zaman aşımına düşüyor -> HB'nin çekişi yarıda kalıyordu. Kendi depomuz: Caddy /storage/v1/object/public/* diskten.
// Dosya adı kaynak adresin özetidir: aynı kaynak ikinci kez indirilmez (yeniden çalıştırılabilir), kaynak değişirse yeni dosya.
import { createHash } from "node:crypto";
import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import { join, dirname } from "node:path";

// Sunucuda disk yolu ve herkese açık adres (Caddy: /srv/storage = /var/lib/trentakip/storage)
export const IMG_DIR = process.env.HB_IMG_DIR || "/var/lib/trentakip/storage/product-images/hb";
export const IMG_PUBLIC = (process.env.HB_IMG_PUBLIC || "https://trentakip.duckdns.org/storage/v1/object/public/product-images/hb").replace(/\/+$/, "");
export const IMG_SIZE = 1200;

// Göreli yol: <ürün kimliği>/<kaynak adres özeti>.jpg (ürün kimliği yalnızca güvenli karakterler)
export function hostedRel(productId: string, srcUrl: string) {
  const pid = String(productId).replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "x";
  return `${pid}/${createHash("sha1").update("v1:" + srcUrl).digest("hex").slice(0, 20)}.jpg`;
}
export const hostedUrl = (rel: string, base = IMG_PUBLIC) => `${base}/${rel}`;

// HB görsel geri bildirimi: "Image3: ... erişim problemi ..." -> sınıf başına görsel sırası (1'den başlar)
export type ImgIssues = { access: number[]; small: number[]; watermark: number[]; sensitive: number[]; other: number[] };
export function parseImageReasons(reasons: string | null | undefined): ImgIssues {
  const out: ImgIssues = { access: [], small: [], watermark: [], sensitive: [], other: [] };
  for (const part of String(reasons ?? "").split(/\s+·\s+|;\s+/)) {
    const m = /Image\s*(\d+)\s*:\s*(.*)$/i.exec(part.trim());
    if (!m) continue;
    const n = Number(m[1]), t = m[2].toLocaleLowerCase("tr");
    const k: keyof ImgIssues = /erişim problemi|indirilememiş/.test(t) ? "access" : /piksel|çözünürlük|küçük boyut/.test(t) ? "small"
      : /filigran/.test(t) ? "watermark" : /hassas içerik|\+18/.test(t) ? "sensitive" : "other";
    if (!out[k].includes(n)) out[k].push(n);
  }
  return out;
}

// Gönderilecek görseller: ilk 5 kaynak görsel; filigranlı / hassas içerikli sıradakiler çıkarılır (yapay zekâyla filigran silinmez).
// Hiç görsel kalmazsa boş döner (K'ya listelenir).
export function pickImages(urls: string[], issues: ImgIssues, max = 5) {
  const bad = new Set([...issues.watermark, ...issues.sensitive]);
  const first = urls.slice(0, max);
  const keep = first.filter((_, i) => !bad.has(i + 1));
  const dropped = first.filter((_, i) => bad.has(i + 1));
  return { keep, dropped };
}

// Görseli çevir: beyaz zemin, 1200x1200 kareye "contain" (küçükse lanczos3 ile büyütülür), JPEG q85, üst veri yok
export async function toJpeg(input: Buffer, size = IMG_SIZE): Promise<{ buf: Buffer; w: number; h: number }> {
  const sharp = (await import("sharp")).default;
  sharp.cache(false); sharp.concurrency(1);
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const buf = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 }, kernel: "lanczos3", withoutEnlargement: false })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { buf, w: meta.width ?? 0, h: meta.height ?? 0 };
}

// Tedarikçiden indir (kibar: tek istek, zaman aşımı, 2 deneme), çevir, diske yaz. Var olan dosya yeniden indirilmez.
export async function hostImage(productId: string, srcUrl: string, opts: { dir?: string; timeoutMs?: number } = {}) {
  const rel = hostedRel(productId, srcUrl);
  const file = join(opts.dir ?? IMG_DIR, rel);
  try { const s = await stat(file); if (s.size > 1024) return { rel, url: hostedUrl(rel), cached: true, srcW: 0, srcH: 0 }; } catch { /* yok */ }
  let lastErr = "";
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(srcUrl, { signal: AbortSignal.timeout(opts.timeoutMs ?? 45000), headers: { "user-agent": "Mozilla/5.0 (trentakip image prep)" } });
      if (!r.ok) { lastErr = `HTTP ${r.status}`; await r.body?.cancel().catch(() => {}); if (r.status === 404 || r.status === 410) break; continue; }
      const input = Buffer.from(await r.arrayBuffer());
      if (input.length < 200) { lastErr = "boş dosya"; continue; }
      const { buf, w, h } = await toJpeg(input);
      await mkdir(dirname(file), { recursive: true });
      const tmp = file + ".tmp" + process.pid;
      await writeFile(tmp, buf, { mode: 0o644 });
      await rename(tmp, file);
      return { rel, url: hostedUrl(rel), cached: false, srcW: w, srcH: h };
    } catch (e: any) { lastErr = String(e?.message ?? e).slice(0, 120); }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`görsel hazırlanamadı (${lastErr})`);
}

// Herkese açık adres gerçekten açılıyor mu (200, image/jpeg, > 1 KB)
export async function publicOk(url: string, timeoutMs = 20000) {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return r.ok && /image\/jpeg/i.test(r.headers.get("content-type") ?? "") && Number(r.headers.get("content-length") ?? 2000) > 1024;
  } catch { return false; }
}
