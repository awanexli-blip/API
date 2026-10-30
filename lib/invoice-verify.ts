// Trendyol'a fatura yüklemeden önce kesin eşleşme (K, 30.10: "yanlış girmeyelim, tam eşleştirelim"). Saf, test edilir.
// GİB'in imzalı belge görünümünde (HTML) şunların HEPSİ olmalı: ETTN, belge no, sipariş no, alıcı adı, ödenecek tutar = sistemdeki tutar.
// Biri eksik/uyuşmazsa yüklenmez (nedenler döner). Alıcı adı yalnızca karşılaştırılır, dönen nedenlere yazılmaz.
export type VerifyInput = { html: string; ettn: string; belgeNo: string; orderNo: string; amount: number; customerName: string };

// GİB şablonu (XSLT, HTML çıktısı) Türkçe harfleri adlı varlık olarak yazabilir (&Ouml;denecek, &Ccedil;): 30.10 ilk denemede 78/78 tutar ve
// 24 alıcı adı okunamadı. Adlı varlıklar büyük/küçük harfe duyarlı (Ouml ≠ ouml).
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", Ouml: "Ö", ouml: "ö", Uuml: "Ü", uuml: "ü", Ccedil: "Ç", ccedil: "ç",
  Acirc: "Â", acirc: "â", Icirc: "Î", icirc: "î", Ucirc: "Û", ucirc: "û", Euml: "Ë", euml: "ë", Iuml: "Ï", iuml: "ï", Auml: "Ä", auml: "ä", Eacute: "É", eacute: "é",
  Scedil: "Ş", scedil: "ş", Gbreve: "Ğ", gbreve: "ğ", Idot: "İ", imath: "ı", inodot: "ı", shy: "", ndash: "-", mdash: "-", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', middot: "·" };
export const decodeEntities = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? ENT[e.toLowerCase()] ?? m);
export function htmlText(html: string) {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
// Ad karşılaştırması: Türkçe harfler ASCII'ye katlanır (GİB büyük harfe çevirirken İ/I, ı/I farkı çıkabiliyor), harf dışı atılır
const fold = (s: string) => s.normalize("NFC").replace(/[İIıi]/g, "I").replace(/[Şş]/g, "S").replace(/[Ğğ]/g, "G").replace(/[Üüû]/g, "U").replace(/[Öö]/g, "O").replace(/[Çç]/g, "C").replace(/[Ââ]/g, "A").replace(/[Îî]/g, "I")
  .toUpperCase().replace(/[^A-Z]/g, "");
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
  const name = fold(v.customerName ?? "");
  if (name.length < 4) problems.push("alıcı adı sistemde yok");
  else if (!fold(text).includes(name)) problems.push("alıcı adı belgedekiyle aynı değil");
  // Etiket: "Ödenecek Tutar" (yoksa belgede gömülü UBL'deki PayableAmount)
  const m = text.match(/(?:Ö|O)DENECEK\s+TUTAR[^\d]{0,60}?(\d[\d.,]*)/i);
  const ubl = decodeEntities(v.html).match(/PayableAmount[^>]*>\s*([\d.]+)\s*</i);
  const paid = m ? parseMoney(m[1]) : ubl ? Number(ubl[1]) : null;
  if (paid == null) problems.push("ödenecek tutar belgede okunamadı");
  else if (Math.abs(paid - v.amount) > 0.01) problems.push(`tutar farklı (belge ${paid.toFixed(2)}, sistem ${v.amount.toFixed(2)})`);
  return { ok: problems.length === 0, problems, paid };
}

// Tanı (yalnızca veritabanındaki rapora; herkese açık günlüğe değil): belge yapısı + tutar/toplam etiketlerinin çevresi, alıcı adının harfleri maskeli
export function invoiceDiag(html: string, customerName: string) {
  const text = htmlText(html);
  const tokens = (customerName ?? "").split(/\s+/).filter((t) => t.length >= 2).map((t) => fold(t)).filter(Boolean);
  const mask = (s: string) => s.replace(/[\p{L}]+/gu, (w) => (tokens.some((t) => fold(w).includes(t) || t.includes(fold(w)) && fold(w).length >= 3) ? "***" : w));
  const near = [...text.matchAll(/.{0,25}(tutar|toplam|denecek|matrah).{0,35}/gi)].slice(0, 8).map((x) => mask(x[0]));
  return { len: html.length, ubl: /PayableAmount/i.test(html), xsl: /xsl|xml-stylesheet/i.test(html), scripts: (html.match(/<script/gi) ?? []).length, tables: (html.match(/<table/gi) ?? []).length,
    entities: [...new Set(html.match(/&[a-z]+;/gi) ?? [])].slice(0, 20), near };
}
