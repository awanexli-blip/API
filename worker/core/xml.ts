import { XMLParser } from "fast-xml-parser";
import { env } from "./util.ts";

export async function loadXml(): Promise<any[]> {
  const res = await fetch(env("XML_URL"));
  if (!res.ok) throw new Error(`XML indirilemedi: ${res.status}`);
  const parsed = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(await res.text());
  const find = (o: any): any[] | null => {
    if (Array.isArray(o) && o.length && typeof o[0] === "object" && "barcode" in o[0]) return o;
    if (o && typeof o === "object") for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  const rows = find(parsed);
  if (!rows) throw new Error("XML içinde 'barcode' alanlı ürün listesi bulunamadı");
  return rows;
}
