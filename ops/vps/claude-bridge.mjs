// Telegram -> sunucudaki Claude Code köprüsü (K 15.11: "sunucuda yapalım"; bilgisayar kapalıyken de çalışsın).
// claude_inbox'taki okunmamış mesajları sırayla alır, `claude -p --continue` ile sunucudaki oturuma verir, cevabı Telegram'a yazar.
// Servis: trentakip-claude-bridge.service (User=trentakip; sudo/docker yok). Nabız: app_state claude:heartbeat (bot "Claude açık" der).
// Kimlik: /etc/trentakip/claude.env içinde ANTHROPIC_API_KEY ya da trentakip kullanıcısıyla `claude` girişi (abonelik).
// Mesaj içerikleri günlüğe yazılmaz.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const URL_ = process.env.VPS_SUPABASE_URL, KEY = process.env.VPS_SERVICE_ROLE_KEY;
const TG = process.env.TELEGRAM_BOT_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
const CLAUDE = process.env.CLAUDE_BIN || "claude";
const STARTED = "/var/lib/trentakip/claude-bridge.started"; // ilk mesajdan sonra --continue ile aynı sohbet sürer
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 20 * 60_000);
if (!URL_ || !KEY || !TG || !CHAT) { console.error("eksik ortam değişkeni (VPS_SUPABASE_URL / VPS_SERVICE_ROLE_KEY / TELEGRAM_*)"); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = (p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
const tg = (method, body) => fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }).catch(() => null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function say(text) {
  const t = String(text || "").trim() || "(boş cevap)";
  for (let i = 0; i < t.length; i += 3900) await tg("sendMessage", { chat_id: CHAT, text: (i ? "" : "🤖 ") + t.slice(i, i + 3900), disable_web_page_preview: true });
}

const SYSTEM = `Telegram üzerinden K (mağaza sahibi) ile konuşuyorsun; sunucudasın (/opt/trentakip, kullanıcı trentakip; sudo ve docker yok).
Kurallar: Türkçe, kısa ve net cevap ver (Telegram mesajı). Önce CLAUDE.md ve docs/PROGRESS.md en üstünü dikkate al.
Veritabanı: sunucu PostgREST. Worker komutlarını şöyle çalıştır: SUPABASE_URL=$VPS_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY=$VPS_SERVICE_ROLE_KEY node --experimental-strip-types --no-warnings worker/<dosya>.ts ...
Canlıya yazan, toplu ya da geri dönüşü olmayan işlemlerde (silme, toplu fiyat/stok, pazaryerine gönderim, müşteriye cevap) ÖNCE ne yapacağını ve etkisini (kaç ürün) yaz, K "evet/tamam" demeden yapma; K'nın cevabı sonraki mesajda gelir.
Müşteri kişisel verisini (ad, adres, telefon) ve gizli anahtarları asla yazma. Kod değiştirirsen test çalıştır; git push yapma (K'ya söyle).`;

function runClaude(prompt) {
  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "text", "--append-system-prompt", SYSTEM,
      "--allowedTools", "Bash Read Grep Glob Edit Write WebSearch WebFetch"];
    if (existsSync(STARTED)) args.splice(1, 0, "--continue");
    const ch = spawn(CLAUDE, args, { cwd: "/opt/trentakip", env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const kill = setTimeout(() => { ch.kill("SIGTERM"); err += "\nzaman aşımı"; }, TIMEOUT_MS);
    ch.stdout.on("data", (d) => (out += d));
    ch.stderr.on("data", (d) => (err += d));
    ch.on("close", (code) => { clearTimeout(kill); resolve({ code, out, err }); });
    ch.on("error", (e) => { clearTimeout(kill); resolve({ code: -1, out: "", err: String(e?.message ?? e) }); });
    ch.stdin.end(prompt);
  });
}

async function heartbeat() {
  await rest("app_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "claude:heartbeat", value: new Date().toISOString(), updated_at: new Date().toISOString() }) }).catch(() => null);
}

for (;;) {
  try {
    await heartbeat();
    const r = await rest("claude_inbox?seen_at=is.null&order=id.asc&limit=5&select=id,text");
    const list = r.ok ? await r.json() : [];
    for (const m of list) {
      await rest(`claude_inbox?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ seen_at: new Date().toISOString() }) });
      const typing = setInterval(() => tg("sendChatAction", { chat_id: CHAT, action: "typing" }), 4500);
      tg("sendChatAction", { chat_id: CHAT, action: "typing" });
      const res = await runClaude(m.text);
      clearInterval(typing);
      if (res.code === 0 && res.out.trim()) { writeFileSync(STARTED, new Date().toISOString()); await say(res.out); }
      else {
        const why = /login|auth|api key|credential|401/i.test(res.err) ? "Claude'a giriş yapılmamış (sunucuda `sudo -u trentakip claude` ile giriş ya da claude.env'de ANTHROPIC_API_KEY)." : `Claude hata verdi (kod ${res.code}).`;
        console.error(`mesaj #${m.id}: kod ${res.code}: ${res.err.slice(-300)}`);
        await say(`❗ ${why}`);
      }
      await heartbeat();
    }
  } catch (e) { console.error("döngü:", String(e?.message ?? e).slice(0, 200)); }
  await sleep(8000);
}
