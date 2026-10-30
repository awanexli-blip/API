// Yeni tedarikçi inceleme (sunucudan; IP izinli XML / REST API): her linkte ürün sayısı, boyut, alan yolları, doluluk, örnek ve önerilen eşleme.
// Veritabanına YAZMAZ; adres ve anahtar yazdırılmaz. Eşleme yapılmamış (taslak) tedarikçide de çalışır.
// node --experimental-strip-types worker/supplier-probe.ts <tedarikçi kodu> [api sayfa sayısı, varsayılan 3]
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import { env, arg, SUPPLIER_ARG } from "./core/util.ts";
import { safeFetch } from "./core/safe-fetch.ts";
import { fetchApiItems, loadSupplierSecrets } from "../lib/supplier-api.ts";
import { fieldStats, findItems, suggestMapping, type Feed } from "../lib/supplier-xml.ts";

const parseXml = (text: string) => new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(text);
const code = arg(process.argv[2], "", SUPPLIER_ARG, "tedarikçi");
const pages = Math.max(1, Math.min(50, Number(process.argv[3] ?? 3) || 3));
loadSupplierSecrets(process.env.SUPPLIER_SECRETS);
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const { data: sup, error } = await db.from("suppliers").select("*").eq("code", code).maybeSingle();
if (error || !sup) throw new Error(`Tedarikçi bulunamadı: ${code}`);

const mainUrl = sup.xml_url || (sup.url_from_env ? process.env[sup.url_from_env] : "");
const feeds: (Feed & { url: string })[] = [...(mainUrl ? [{ id: "ana", label: "Ana link", url: mainUrl, item_path: sup.item_path }] : []), ...((sup.feeds ?? []) as Feed[]).map((f) => ({ ...f, url: String(f.url ?? "") }))];
console.log(`${sup.name}: ${feeds.length} link · runner=${sup.runner ?? "-"} · nightly=${sup.nightly ? "açık" : "KAPALI (sunucu yalnızca nightly açık tedarikçiyi okur)"} · eşleme ${sup.mapping && Object.keys(sup.mapping).length ? "var" : "yok"}`);

for (const [i, f] of feeds.entries()) {
  const name = f.label || f.id || `Link ${i + 1}`;
  const t0 = Date.now();
  try {
    if (!f.url) { console.log(`\n## ${name}: adres yok`); continue; }
    let items: any[] = [], path = "", extra = "";
    if (f.type === "api") {
      const r = await fetchApiItems(f.url, f.api ?? {}, { label: name, partial: true, maxPages: pages, parseXml });
      items = r.items; path = r.path || "kök"; extra = `API ${r.pages} sayfa okundu${r.more ? " (devamı var)" : " (tamamı)"}`;
    } else {
      const res = await safeFetch(f.url, { maxBytes: 300 * 1048576, timeoutMs: 5 * 60_000 });
      if (!res.ok) { console.log(`\n## ${name}: HTTP ${res.status} (IP izni / adres?)`); continue; }
      const found = findItems(parseXml(res.text()), f.item_path ?? sup.item_path);
      items = found.items; path = found.path; extra = `XML ${(res.body.length / 1048576).toFixed(1)} MB`;
    }
    console.log(`\n## ${name}: ${items.length} ürün · yol "${path}" · ${extra} · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
    const st = fieldStats(items, 500);
    for (const s of st) console.log(`  ${s.path}  %${s.fill}  ${s.samples.map((x) => JSON.stringify(x.replace(/\s+/g, " ").slice(0, 60))).join(" · ")}`);
    console.log(`  önerilen eşleme: ${JSON.stringify(suggestMapping(st.map((s) => s.path)))}`);
  } catch (e: any) {
    console.log(`\n## ${name}: HATA ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
