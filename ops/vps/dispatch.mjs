// VPS zamanlayıcısı: GitHub "Trendyol sync" iş akışını tam vaktinde başlatır (GitHub'ın kendi cron'u 40 dk - 2,5 saat gecikiyordu).
// trigger=schedule gönderilir: panelde otomatik senkron duraklatıldıysa çalışma kendiliğinden atlanır (elle tetikleme gibi davranmaz).
// Aynı pazaryerinde çalışan iş varsa GitHub sıraya alır (concurrency), yığılma olmaz.
// Ortam: GH_TOKEN (fine-grained, bu depo, Actions: read and write), GH_REPO, SYNC_MARKETPLACES (JSON dizi, ör. ["trendyol","hepsiburada"])
const token = process.env.GH_TOKEN, repo = process.env.GH_REPO || "awanexli-blip/API";
if (!token) { console.error("GH_TOKEN yok (/etc/trentakip/env)"); process.exit(1); }
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error("GH_REPO geçersiz"); process.exit(1); }
let markets;
try { markets = JSON.parse(process.env.SYNC_MARKETPLACES || '["trendyol","hepsiburada"]'); } catch { console.error("SYNC_MARKETPLACES JSON dizi olmalı"); process.exit(1); }
const allowed = new Set(["trendyol", "hepsiburada", "amazon"]);
let failed = 0;
for (const m of markets) {
  if (!allowed.has(m)) { console.error(`bilinmeyen pazaryeri: ${m}`); failed++; continue; }
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/sync.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "trentakip-vps" },
    body: JSON.stringify({ ref: "main", inputs: { mode: "auto", marketplace: m, trigger: "schedule", limit: "50" } }),
    signal: AbortSignal.timeout(30000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e?.message ?? e) }));
  if (r.ok) console.log(`${new Date().toISOString()} ${m}: başlatıldı`);
  else { failed++; console.error(`${m}: GitHub ${r.status} ${(await r.text()).slice(0, 200)}`); }
}
process.exit(failed ? 1 : 0);
