import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Panelden iş başlatma. İki yer:
// - Sunucu ana sistemken (panel.env RUN_SITE=sunucu, tam taşıma 12.11): istek sunucunun iş kuyruğuna dosya olarak yazılır
//   (RUN_QUEUE_DIR, varsayılan /var/lib/trentakip/runq); trentakip-runq.path onu görür, ops/vps/runq.sh izinli birimi başlatır.
//   Sunucu GitHub'ı çağırmaz: GitHub Supabase'e (yedek) yazar.
// - Aksi halde (Vercel paneli = yedek): GitHub Actions iş akışı (GH_TOKEN fine-grained, Actions: Read and write; GH_REPO).
export const RUN_FILES = ["sync.yml", "import.yml", "invoice-upload.yml", "catalog.yml"] as const;
export type RunFile = (typeof RUN_FILES)[number];

export const onServer = () => process.env.RUN_SITE === "sunucu";

export async function dispatchWorkflow(file: RunFile, inputs: Record<string, string> = {}): Promise<{ ok: boolean; error?: string }> {
  if (!RUN_FILES.includes(file)) return { ok: false, error: `Bilinmeyen iş: ${file}` };
  for (const [k, v] of Object.entries(inputs)) if (!/^[a-z_]{1,20}$/.test(k) || !/^[A-Za-z0-9@._-]{0,80}$/.test(v)) return { ok: false, error: `Geçersiz parametre: ${k}` };
  if (onServer()) {
    try {
      const dir = process.env.RUN_QUEUE_DIR || "/var/lib/trentakip/runq";
      mkdirSync(dir, { recursive: true });
      const name = `${Date.now()}-${randomUUID().slice(0, 8)}.json`;
      // Yarım dosya okunmasın: önce gizli adla yaz, sonra yeniden adlandır (path birimi yalnızca .json'u işler)
      writeFileSync(join(dir, `.${name}.tmp`), JSON.stringify({ file, inputs, at: new Date().toISOString() }));
      renameSync(join(dir, `.${name}.tmp`), join(dir, name));
      return { ok: true };
    } catch (e: any) { return { ok: false, error: `Sunucu iş kuyruğuna yazılamadı: ${String(e?.message ?? e).slice(0, 150)}` }; }
  }
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return { ok: false, error: "GH_TOKEN / GH_REPO tanımlı değil" };
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/${file}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 204) return { ok: true };
    if (r.status === 403 || r.status === 404)
      return { ok: false, error: `GitHub ${r.status}: GH_TOKEN bu repoya erişemiyor ("Actions: Read and write" izni olmalı, süresi dolmuş olabilir)` };
    return { ok: false, error: `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}` };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

// Senkronu hemen başlat (mod "update"): onaylı cevap, beklemedeki sipariş kararı, gönderim kuyruğu 15 dk beklemeden işlenir
export async function dispatchSync(marketplace: string, mode = "update"): Promise<boolean> {
  return (await dispatchWorkflow("sync.yml", { mode, marketplace })).ok;
}
