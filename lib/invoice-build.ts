// Siparişten GİB e-Arşiv portalı taslak faturası (EARSIV_PORTAL_FATURA_OLUSTUR / RG_BASITFATURA). Saf, test edilir (tests/invoice.test.ts).
// Alan adları ve biçimler açık kaynak f/fatura (MIT, Ağustos 2026 sürümü) istemcisinden: para "0.00" (nokta), kdvOrani tam sayı metni,
// tarih GG/AA/YYYY, saat SS:DD:ss; faturaUuid boş (ETTN'yi GİB verir).
// Tutar: satıcının geliri = müşterinin ödediği + Trendyol'un karşıladığı indirim (orders.ts "revenue" ile aynı); KDV içinden ayrılır.

export type InvLine = { title: string; qty: number; unit_price: number; ty_discount?: number | null; vat_rate?: number | null };
export type InvOrder = { order_no: string | null; ordered_at: string | null; customer_name: string | null;
  address: { fullAddress?: string; district?: string; city?: string; postalCode?: string; neighborhood?: string } | null; city?: string | null; lines: InvLine[] };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const f2 = (n: number) => r2(n).toFixed(2);
const pad = (n: number) => String(n).padStart(2, "0");

// Türkiye saatiyle GG/AA/YYYY ve SS:DD:ss
export function trDateTime(d: Date) {
  const t = new Date(d.getTime() + 3 * 3600 * 1000);
  return { date: `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`, time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}` };
}

// "Ad Ad Soyad" -> { ad: "Ad Ad", soyad: "Soyad" }
export function splitName(full: string | null) {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { ad: parts[0] ?? "", soyad: "" };
  return { ad: parts.slice(0, -1).join(" "), soyad: parts[parts.length - 1] };
}

const ONES = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
const TENS = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Altmış", "Yetmiş", "Seksen", "Doksan"];
function words(n: number): string {
  if (n === 0) return "Sıfır";
  const chunk = (x: number) => `${x >= 100 ? (Math.floor(x / 100) === 1 ? "" : ONES[Math.floor(x / 100)]) + "Yüz" : ""}${TENS[Math.floor((x % 100) / 10)]}${ONES[x % 10]}`;
  const parts: string[] = [];
  const units = ["", "Bin", "Milyon", "Milyar"];
  let i = 0;
  while (n > 0 && i < units.length) {
    const c = n % 1000;
    if (c) parts.unshift(i === 1 && c === 1 ? "Bin" : chunk(c) + units[i]);
    n = Math.floor(n / 1000); i++;
  }
  return parts.join("");
}
// 1279.9 -> "YalnızBinİkiYüzYetmişDokuzTürkLirasıDoksanKuruş"
export function amountInWords(total: number) {
  const lira = Math.floor(r2(total)), kurus = Math.round((r2(total) - lira) * 100);
  return `Yalnız${words(lira)}TürkLirası${kurus ? words(kurus) + "Kuruş" : ""}`;
}

export function buildInvoice(o: InvOrder, now = new Date()) {
  if (!o.lines.length) throw new Error("Sipariş satırı yok");
  const { date, time } = trDateTime(now);
  const ord = o.ordered_at ? trDateTime(new Date(o.ordered_at)).date : "";
  const rows = o.lines.map((l) => {
    const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
    const vat = [0, 1, 10, 20].includes(Number(l.vat_rate)) ? Number(l.vat_rate) : 20;
    const gross = r2(Number(l.unit_price) * qty + (Number(l.ty_discount) || 0)); // KDV dahil satır tutarı
    const unitNet = r2(gross / (1 + vat / 100) / qty);
    const net = r2(unitNet * qty), kdv = r2(gross - net);
    return { qty, vat, gross, unitNet, net, kdv, name: String(l.title ?? "Ürün").replace(/\s+/g, " ").trim().slice(0, 200) || "Ürün" };
  });
  const matrah = r2(rows.reduce((t, r) => t + r.net, 0)), kdv = r2(rows.reduce((t, r) => t + r.kdv, 0)), total = r2(matrah + kdv);
  const { ad, soyad } = splitName(o.customer_name);
  const a = o.address ?? {};
  const zero = (keys: string[], amount: boolean) => Object.fromEntries(keys.map((k) => [k, amount ? "0" : 0]));
  const fees = ["komisyon", "navlun", "hammaliye", "nakliye"];
  const extra = ["halRusumu", "ticaretBorsasi", "milliSavunmaFonu", "diger"];
  return {
    faturaUuid: "", belgeNumarasi: "", faturaTarihi: date, saat: time, paraBirimi: "TRY", dovzTLkur: "0", faturaTipi: "SATIS", hangiTip: "5000/30000",
    siparisNumarasi: o.order_no ?? "", siparisTarihi: ord, irsaliyeNumarasi: "", irsaliyeTarihi: "", fisNo: "", fisTarihi: "", fisSaati: " ", fisTipi: " ", zRaporNo: "", okcSeriNo: "",
    vknTckn: "11111111111", aliciUnvan: "", aliciAdi: ad.slice(0, 100), aliciSoyadi: soyad.slice(0, 100),
    bulvarcaddesokak: String(a.fullAddress ?? "").slice(0, 250), binaAdi: "", binaNo: "", kapiNo: "", kasabaKoy: "",
    mahalleSemtIlce: String(a.district ?? "").slice(0, 100), sehir: String(a.city ?? o.city ?? " ").slice(0, 60) || " ", ulke: "Türkiye", postaKodu: String(a.postalCode ?? "").slice(0, 10),
    tel: "", fax: "", eposta: "", websitesi: "", vergiDairesi: "",
    ...zero(fees.map((f) => `${f}Orani`), false), ...zero(fees.map((f) => `${f}Tutari`), true),
    ...zero(fees.map((f) => `${f}KDVOrani`), false), ...zero(fees.map((f) => `${f}KDVTutari`), true),
    gelirVergisiOrani: 0, bagkurTevkifatiOrani: 0, gelirVergisiTevkifatiTutari: "0", bagkurTevkifatiTutari: "0",
    ...zero(extra.map((f) => `${f}Orani`), false), ...zero(extra.map((f) => `${f}Tutari`), true),
    ...zero(extra.map((f) => `${f}KDVOrani`), false), ...zero(extra.map((f) => `${f}KDVTutari`), true),
    iadeTable: [], ozelMatrahTutari: "0", ozelMatrahOrani: 0, ozelMatrahVergiTutari: "0.00", vergiCesidi: " ",
    malHizmetTable: rows.map((r) => ({
      iskontoArttm: "İskonto", malHizmet: r.name, miktar: r.qty, birim: "C62", birimFiyat: f2(r.unitNet), fiyat: f2(r.net),
      iskontoOrani: 0, iskontoTutari: "0.00", iskontoNedeni: "", malHizmetTutari: f2(r.net), kdvOrani: r.vat.toFixed(0), vergiOrani: 0,
      kdvTutari: f2(r.kdv), vergininKdvTutari: "0.00",
    })),
    tip: "İskonto", matrah: f2(matrah), malhizmetToplamTutari: f2(matrah), toplamIskonto: "0.00", hesaplanankdv: f2(kdv), vergilerToplami: f2(kdv),
    vergilerDahilToplamTutar: f2(total), toplamMasraflar: "0", odenecekTutar: f2(total), not: amountInWords(total),
    _ozet: { total, kdv, matrah }, // sunucuda çıkarılır, GİB'e gitmez
  };
}
