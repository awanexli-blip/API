// Kesinti tipi -> kategori. Komisyon faturası bilgi (komisyon satış hakedişinde zaten düşülü), kargo faturası başlığı toplam (kalemler ayrıca)
export function feeCategory(kind: string): string {
  const k = kind.toLocaleLowerCase("tr");
  if (/kargo fatura/.test(k)) return "kargo";
  if (/platform hizmet/.test(k)) return "platform";
  if (/komisyon/.test(k)) return "komisyon";
  if (/reklam/.test(k)) return "reklam";
  if (/duyuru/.test(k)) return "duyuru";
  if (/stopaj/.test(k)) return "stopaj";
  if (/tedarik edememe|termin|gecikme|eksik|hatalı|kusurlu|ceza|iptal bedeli|yanlış/.test(k)) return "ceza";
  return "diger";
}
