// Yapay zekâ açıklama taslakları (worker/core/descriptions.ts): her çalışmada en fazla DESC_PER_RUN ürün (varsayılan 10; soru taslaklarıyla aynı kota, Gemini ücretsiz
// kotası ürün başına 2 istek). Yalnızca taslak yazar; pazaryerine bir şey göndermez (onaylananları senkron gönderir).
// node --experimental-strip-types worker/desc-draft.ts
import { createClient } from "@supabase/supabase-js";
import { env } from "./core/util.ts";
import { draftDescriptions } from "./core/descriptions.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const max = Math.max(1, Math.min(200, Number(process.env.DESC_PER_RUN ?? 10) || 10));
const r = await draftDescriptions(db, { max });
console.log(JSON.stringify(r, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Açıklama taslakları\n\n${r.skippedRun ? `Çalışmadı: ${r.skippedRun}` : `Aday ${r.candidates} · hazır ${r.ready} · atlandı ${r.skipped} · hata ${r.errors}${r.quota ? " · kota doldu" : ""}`}\n\n${Object.entries(r.reasons ?? {}).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`);
}
if (r.errors && !r.ready && !r.skipped) process.exit(1);
