// Tedarikçi XML alanları: her linkte alan yolu, doluluk (%), ortalama uzunluk ve kısa örnek. Veritabanına yazmaz; adres yazdırılmaz.
// Çıktı GitHub "notice" satırları (herkese açık depoda annotation olarak okunur): alan eşlemesini (ör. açıklama = detail) doğrulamak için.
// node --experimental-strip-types worker/xml-fields.ts <tedarikçi kodu>
import { createClient } from "@supabase/supabase-js";
import { env, arg, SUPPLIER_ARG } from "./core/util.ts";
import { safeFetch } from "./core/safe-fetch.ts";
import { XMLParser } from "fast-xml-parser";
import { findItems, flatten, type Feed } from "../lib/supplier-xml.ts";

// import-xml.ts ile aynı ayarlar (o dosya içe aktarılmaz: üst düzeyde içe aktarmayı başlatır)
const parseXml = (text: string) => new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(text);

const code = arg(process.argv[2], "", SUPPLIER_ARG, "tedarikçi");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const { data: sup, error } = await db.from("suppliers").select("*").eq("code", code).maybeSingle();
if (error || !sup) throw new Error(`Tedarikçi bulunamadı: ${code}`);
const mainUrl = sup.xml_url || (sup.url_from_env ? process.env[sup.url_from_env] : "");
const feeds: (Feed & { url: string })[] = [{ id: "ana", label: "Ana link", url: mainUrl, item_path: sup.item_path }, ...((sup.feeds ?? []) as Feed[]).map((f) => ({ ...f, url: String(f.url ?? "") }))];
const one = (s: string) => s.replace(/\s+/g, " ").replace(/::/g, ": :").slice(0, 70);
for (const f of feeds) {
  const name = f.label || f.id;
  if (!f.url) { console.log(`::warning title=${name}::adres yok`); continue; }
  const res = await safeFetch(f.url, { maxBytes: 300 * 1048576, timeoutMs: 5 * 60_000 });
  if (!res.ok) { console.log(`::warning title=${name}::HTTP ${res.status}`); continue; }
  const { items, path } = findItems(parseXml(res.text()), f.item_path ?? sup.item_path);
  const part = items.slice(0, 1000);
  const st = new Map<string, { n: number; len: number; same: number; ex: string }>();
  for (const it of part) {
    const flat = flatten(it);
    const title = String(flat.name ?? flat.title ?? "").trim().toLowerCase();
    for (const [k, v] of Object.entries(flat)) {
      const val = Array.isArray(v) ? v.join(" | ") : v;
      const s = st.get(k) ?? { n: 0, len: 0, same: 0, ex: "" };
      s.n++; s.len += val.length; if (title && val.trim().toLowerCase() === title) s.same++;
      if (!s.ex && val.length > 20) s.ex = one(val);
      st.set(k, s);
    }
  }
  console.log(`::notice title=${name} (${path}, ${items.length} ürün)::${[...st.keys()].join(", ").slice(0, 900)}`);
  // Uzun metin alanları ve kategori alanları ayrıntılı (doluluk, ort. uzunluk, başlıkla aynı oranı, örnek)
  for (const [k, s] of [...st].filter(([k, s]) => s.len / s.n > 25 || /categ|kategori|desc|detail|aciklama|açıklama/i.test(k)).slice(0, 25))
    console.log(`::notice title=${name} · ${k}::doluluk %${Math.round((s.n / part.length) * 100)} · ort. ${Math.round(s.len / s.n)} krk · başlıkla aynı %${Math.round((s.same / s.n) * 100)} · örnek: ${s.ex}`);
}
