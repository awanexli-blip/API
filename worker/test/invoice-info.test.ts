// Kurumsal fatura bilgisi okuma (worker/core/invoice-info.ts)
import { tyInvoiceInfo, hbInvoiceInfo, buyerTypeOf } from "../core/invoice-info.ts";
let fails = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "OK  " : "HATA"} ${n}`); if (!ok) fails++; };
const ty = { commercial: true, invoiceAddress: { company: " Örnek  Ltd ", taxNumber: "123 456 7890", taxOffice: "Kadıköy", isEInvoiceAvailable: true, fullAddress: "Cad. 5", district: "Ataşehir", city: "İstanbul" } };
const t = tyInvoiceInfo(ty);
check("TY kurumsal okunur", t?.company === "Örnek Ltd" && t?.taxNumber === "1234567890" && t?.eInvoice === true && t?.district === "Ataşehir");
check("TY e-Fatura mükellefi -> kurumsal_efatura", buyerTypeOf(t) === "kurumsal_efatura");
check("TY bireysel (commercial yok, VKN yok)", tyInvoiceInfo({ invoiceAddress: { company: "", taxNumber: "" } }) === null);
check("TY 11111111111 bireysel", tyInvoiceInfo({ commercial: true, invoiceAddress: { company: "X", taxNumber: "11111111111" } }) === null);
check("TY eksik ünvan -> kurumsal sayılmaz", tyInvoiceInfo({ commercial: true, invoiceAddress: { taxNumber: "1234567890" } }) === null);
const h = hbInvoiceInfo({ companyName: "HB Firma", taxNumber: "9876543210", taxOffice: "Çankaya", billingAddress: "Adres", billingCity: "Ankara" });
check("HB kurumsal, e-Fatura bilinmiyor", h?.eInvoice === null && buyerTypeOf(h) === "kurumsal" && h?.city === "Ankara");
check("bireysel", buyerTypeOf(null) === "bireysel");
if (fails) { console.log(`\n${fails} kurumsal fatura testi başarısız`); process.exit(1); }
console.log("\nKurumsal fatura testleri geçti");
