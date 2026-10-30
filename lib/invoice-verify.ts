// Trendyol'a fatura yüklemeden önce kesin eşleşme (K, 30.10: "yanlış girmeyelim, tam eşleştirelim"). Saf, test edilir.
// GİB'in imzalı belge görünümünde (HTML) şunların HEPSİ olmalı: ETTN, belge no, sipariş no, alıcı adı, ödenecek tutar = sistemdeki tutar.
// Biri eksik/uyuşmazsa yüklenmez (nedenler döner). Alıcı adı yalnızca karşılaştırılır, dönen nedenlere yazılmaz.
export type VerifyInput = { html: string; ettn: string; belgeNo: string; orderNo: string; amount: number; customerName: string };

const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function htmlText(html: string) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ").trim();
}
const letters = (s: string) => s.toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ]/g, "");
// "1.968,00" / "1968,00" / "1,968.00" / "1968.00" -> 1968
export function parseMoney(s: string): number | null {
  const t = s.replace(/[^\d.,]/g, "");
  if (!t) return null;
  const lastSep = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  const dec = lastSep >= 0 && t.length - lastSep - 1 === 2 ? t[lastSep] : null;
  const n = dec ? Number(t.slice(0, lastSep).replace(/[.,]/g, "") + "." + t.slice(lastSep + 1)) : Number(t.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function verifyInvoice(v: VerifyInput) {
  const problems: string[] = [];
  const text = htmlText(v.html);
  const up = text.toLocaleUpperCase("tr");
  if (!v.ettn || !up.includes(v.ettn.toLocaleUpperCase("tr"))) problems.push("ETTN belgede yok");
  if (!v.belgeNo || !up.includes(v.belgeNo.toLocaleUpperCase("tr"))) problems.push("belge no belgede yok");
  // Tam sayı olarak geçmeli (başka bir numaranın parçası değil)
  if (!/^\d{5,20}$/.test(v.orderNo ?? "") || !new RegExp(String.raw`(^|\D)${v.orderNo}(\D|$)`).test(text)) problems.push("sipariş no belgede yok");
  const name = letters(v.customerName ?? "");
  if (name.length < 4) problems.push("alıcı adı sistemde yok");
  else if (!letters(text).includes(name)) problems.push("alıcı adı belgedekiyle aynı değil");
  const m = text.match(/Ödenecek\s+Tutar[^\d]{0,40}([\d.,]+)/i);
  const paid = m ? parseMoney(m[1]) : null;
  if (paid == null) problems.push("ödenecek tutar belgede okunamadı");
  else if (Math.abs(paid - v.amount) > 0.01) problems.push(`tutar farklı (belge ${paid.toFixed(2)}, sistem ${v.amount.toFixed(2)})`);
  return { ok: problems.length === 0, problems, paid };
}
