// İçerik düzeltme doğruluk denemesi (yerel, veritabanı gerekmez): etiketli kümedeki görselli ürünlerde iki FARKLI modelle görsel ölçü okuması
// (OmniRoute ya da DIMS_MODELS) ve sonuç eylemi. Görseller Claude tarafından ayrıca bakılarak doğrulanır (rapor PROGRESS'e).
//   DIMS_MODELS="omni:gemini/gemini-2.5-flash,omni:ddgw/mistral-small-2603" node --experimental-strip-types worker/content-fix-eval.ts [--only-extra] ["görsel::açıklama::başlık" ...]
import { fetchImage, readDimsTwoModels, visionCallers } from "./core/image-dims.ts";
import { detectAll, needsDimRead } from "./core/contradictions.ts";
import { readFileSync, existsSync } from "node:fs";
import { LABELED } from "./test/fixtures/content-fix-labeled.ts";

const callers = visionCallers();
if (callers.length < 2) { console.error("DIMS_MODELS ile iki model ver"); process.exit(2); }
// Ek vaka: "<görsel adresi ya da yerel dosya>::<açıklama>::<başlık>" (ör. ölçü yazısı eklenmiş denetim görseli)
const extra = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a, i) => { const [image, description = "", title = ""] = a.split("::"); return { id: `ek-${i + 1}`, title, description, image }; });
const cases = [...(process.argv.includes("--only-extra") ? [] : LABELED.filter((c) => c.image)), ...extra];
const load = async (src: string) => /^https?:\/\//.test(src) ? fetchImage(src) : existsSync(src) ? { mime: /\.png$/i.test(src) ? "image/png" : /\.webp$/i.test(src) ? "image/webp" : "image/jpeg", b64: readFileSync(src).toString("base64") } : null;
for (const c of cases) {
  const img = await load(c.image!);
  if (!img) { console.log(JSON.stringify({ id: c.id, hata: "görsel indirilemedi" })); continue; }
  let reads = null;
  for (let t = 0; t < 3 && !reads; t++) {
    try { reads = await readDimsTwoModels(img, callers, (m) => console.error(m)); }
    catch (e: any) { console.error(`(${String(e?.message).slice(0, 80)}; 60 sn bekleniyor)`); await new Promise((r) => setTimeout(r, 60_000)); }
  }
  await new Promise((r) => setTimeout(r, Number(process.env.EVAL_GAP_MS ?? 15000)));
  const f = c.description ? detectAll(c, { dimReads: reads }) : [];
  console.log(JSON.stringify({ id: c.id, aciklamaOlcu: c.description ? needsDimRead(c.description)?.raw ?? null : null,
    okuma: reads ? { [reads.models[0]]: reads.a?.map((d) => d.values.join("x")) ?? "okunamadı", [reads.models[1]]: reads.b?.map((d) => d.values.join("x")) ?? "okunamadı" } : null,
    eylem: f.filter((x) => x.kind === "olcu").map((x) => `${x.action}${x.replacement ? ` -> ${x.replacement}` : ""}`) }));
}
