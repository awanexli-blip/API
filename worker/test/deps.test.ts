// Worker betiklerinin içe aktarma ağacı: Actions yalnızca worker/node_modules kurar. worker/ dışındaki (lib/) bir dosya üstte
// worker/package.json'da olmayan bir paketi içe aktarırsa betik "Cannot find package" ile hiç başlamaz (28-29.10: XML içe aktarma 32 saat durdu).
// Ayrıca lib/ dosyaları paketi worker/node_modules'tan değil kök node_modules'tan arar: worker dışı dosyada üstte paket içe aktarımı hiç olmamalı.
// node --experimental-strip-types worker/test/deps.test.ts
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workerDir = join(root, "worker");
const deps = new Set(Object.keys(JSON.parse(readFileSync(join(workerDir, "package.json"), "utf8")).dependencies ?? {}));
const entries = readdirSync(workerDir).filter((f) => f.endsWith(".ts")).map((f) => join(workerDir, f));
const seen = new Set<string>();
const problems: string[] = [];
// Yalnızca üstteki statik içe aktarımlar (dinamik `await import()` gerektiğinde yüklenir, burada sayılmaz); `import type` derlemede silinir
const STATIC = /^\s*import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

function visit(file: string) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(STATIC)) {
    const spec = m[1];
    if (spec.startsWith("node:")) continue;
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      if (existsSync(target)) visit(target);
      continue;
    }
    if (spec.startsWith("@/")) { problems.push(`${relative(root, file)}: "${spec}" takma adı worker'da çözülmez`); continue; }
    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    const inWorker = file.startsWith(workerDir + (file.includes("\\") ? "\\" : "/"));
    if (!inWorker) problems.push(`${relative(root, file)}: "${pkg}" paketi üstte içe aktarılıyor (worker dışı dosya; Actions'ta çözülmez)`);
    else if (!deps.has(pkg)) problems.push(`${relative(root, file)}: "${pkg}" worker/package.json'da yok`);
  }
}
for (const e of entries) visit(e);

console.log(`${seen.size} dosya tarandı (${entries.length} worker betiği)`);
for (const p of problems) console.log("HATA " + p);
if (problems.length) { console.log(`\n${problems.length} bağımlılık sorunu`); process.exit(1); }
console.log("Bağımlılık testleri geçti");
