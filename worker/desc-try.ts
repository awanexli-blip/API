// Açıklama + ürün araştırması denemesi (yerel, veritabanına yazmaz, pazaryerine gitmez): bir ürünün başlığı, görseli, açıklaması verilir.
// GEMINI_API_KEY ortamda ya da %USERPROFILE%\.config\trentakip\gemini.key dosyasında.
// node --experimental-strip-types worker/desc-try.ts "<başlık>" "<görsel adresi>" ["<tedarikçi açıklaması>"]
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { researchProduct } from "./core/research.ts";
import { composeDescription } from "./core/descriptions.ts";

if (!process.env.GEMINI_API_KEY) {
  const f = join(homedir(), ".config", "trentakip", "gemini.key");
  if (existsSync(f)) process.env.GEMINI_API_KEY = readFileSync(f, "utf8").trim();
}
const [title, image, desc] = [process.argv[2] ?? "", process.argv[3] ?? "", process.argv[4] ?? process.argv[2] ?? ""];
if (!title || !image) { console.error('kullanım: desc-try.ts "<başlık>" "<görsel>" ["<açıklama>"]'); process.exit(2); }
const t0 = Date.now();
const rr = await researchProduct({ title, description: desc, image_url: image });
console.log(`\n== Araştırma (${Math.round((Date.now() - t0) / 1000)} sn): ${rr.research.status}`);
console.log("aramalar:", JSON.stringify(rr.research.queries ?? []));
for (const c of rr.research.candidates ?? []) console.log(`  aday: ${c.same ? "AYNI" : "farklı/emin değil"} · ${String(c.name).slice(0, 70)} · ${String(c.url).slice(0, 90)}\n         ${c.reason ?? ""}`);
console.log("doğrulanan bilgiler:"); for (const f of rr.facts) console.log(`  + ${f.name}: ${f.value}   «${f.quote.slice(0, 100)}»`);
console.log("atılanlar:"); for (const d of rr.research.dropped ?? []) console.log(`  - ${d.name}: ${d.value} (${d.reason})`);
const c = { id: "deneme", title, description: desc, brand: null, category: null, attributes: null, source_hash: "", image_url: image };
const r = await composeDescription(c, rr.facts, { forbidden: rr.research.foreignNames ?? [] });
console.log(`\n== Açıklama: ${r.status}${r.status === "skipped" ? ` (${r.reason})` : ""}`);
if (r.status === "ready") console.log(r.html); else if (r.checks?.draft) console.log("(reddedilen taslak)\n" + r.checks.draft);
console.log(`\ntoplam ${Math.round((Date.now() - t0) / 1000)} sn`);
