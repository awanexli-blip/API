// Portalda ELLE kesilen e-Arşiv faturalarını siparişlerle eşleştir (K, 30.10: "bazılarını kendim kestim"). Saf, test edilir.
// Kural: imzalı, sistemde kayıtlı olmayan (ETTN) belge; alıcı adı (Türkçe büyük harf, harf dışı atılır) tek bir faturasız siparişle
// eşleşiyor ve sipariş belge tarihinden önce (en fazla 1 gün tolerans) verilmiş. Birden fazla aday = eşleştirilmez (yanlış eşleşme riski).
import { isSigned, type EarsivDoc } from "./earsiv.ts";

export type MatchOrder = { id: string; customer_name: string | null; ordered_at: string | null };
const norm = (s: unknown) => String(s ?? "").toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ]/g, "");

export function docName(d: EarsivDoc) {
  return String(d.aliciUnvanAdSoyad ?? d.aliciUnvan ?? `${(d as any).aliciAdi ?? ""} ${(d as any).aliciSoyadi ?? ""}`);
}
// "30-10-2026" / "30/10/2026" -> ms (gün sonu); okunamazsa null
export function docTime(d: EarsivDoc): number | null {
  const m = String(d.belgeTarihi ?? "").match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59) : null;
}

export function matchManualInvoices(docs: EarsivDoc[], orders: MatchOrder[], knownEttn: Set<string>) {
  const links: { order_id: string; ettn: string; belge_no: string | null }[] = [];
  let ambiguous = 0, unmatched = 0;
  const used = new Set<string>();
  for (const d of docs) {
    if (!isSigned(d) || !d.ettn || knownEttn.has(d.ettn)) continue;
    const name = norm(docName(d)), t = docTime(d);
    if (!name || name.length < 4) { unmatched++; continue; }
    const cands = orders.filter((o) => !used.has(o.id) && norm(o.customer_name) === name && (t == null || !o.ordered_at || Date.parse(o.ordered_at) <= t + 86400000));
    if (cands.length === 1) { links.push({ order_id: cands[0].id, ettn: d.ettn, belge_no: d.belgeNumarasi ?? null }); used.add(cands[0].id); }
    else if (cands.length > 1) ambiguous++;
    else unmatched++;
  }
  return { links, ambiguous, unmatched };
}
