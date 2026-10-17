// Ürün doğrulama şeması: panel formu (tarayıcı) ve API (sunucu) aynı kuralları kullanır.
// Veritabanı kısıtları (supabase/migrations/003_products.sql) ile uyumlu tutulmalı.
import { z } from "zod";

// Türkçe harfler izinli: mevcut Trendyol ürünlerinin kodları "ÖS13-…" (yeni açılanlar "OS13-…")
export const SKU_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{2,64}$/;
export const CODE_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/; // iç barkod (Trendyol: en fazla 40 karakter, özel karakter olarak yalnızca . _ -)
export const VAT_RATES = [0, 1, 10, 20] as const;
export const STATUSES = ["draft", "active", "archived"] as const;
export const CURRENCIES = ["TRY", "USD", "EUR"] as const;

// GTIN-8/12/13/14 sağlama toplamı (sağdan sola 3,1,3,1... ağırlıklar)
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Otomatik barkod: "2" ile başlayan EAN-13 (GS1'in mağaza içi kullanıma ayırdığı aralık, gerçek bir ürünle çakışmaz).
// Trendyol, Hepsiburada, N11, ÇiçekSepeti kabul eder. Amazon gerçek GTIN veya muafiyet ister.
export function generateEan13(rand: () => number = Math.random): string {
  let body = "2";
  while (body.length < 12) body += Math.floor(rand() * 10);
  const sum = body.split("").map(Number).reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}
export const isInternalEan = (b: string | null | undefined) => !!b && /^2\d{12}$/.test(b);

// Otomatik SKU: başlıktan kısa kök + rastgele ek (örn. "BAMBU-KESME-7K3Q")
export function generateSku(title = "", rand: () => number = Math.random): string {
  const map: Record<string, string> = { ç: "C", ğ: "G", ı: "I", i: "I", ö: "O", ş: "S", ü: "U" };
  const root = title.toLocaleLowerCase("tr").replace(/[çğıiöşü]/g, (c) => map[c]).toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 1).slice(0, 2).join("-").slice(0, 20);
  let tail = "";
  while (tail.length < 4) tail += "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(rand() * 31)];
  return (root ? root + "-" : "URN-") + tail;
}

// Boş = barkod yok. Yalnızca rakamsa GTIN olmalı, değilse iç kod kuralı.
export function barcodeError(b: string | null | undefined): string | null {
  if (!b) return null;
  if (/^\d+$/.test(b)) {
    if (![8, 12, 13, 14].includes(b.length)) return "Rakamlardan oluşan barkod 8, 12, 13 veya 14 hane olmalı (GTIN/EAN)";
    return isValidGtin(b) ? null : "Barkodun kontrol hanesi hatalı (GTIN/EAN sağlama toplamı tutmuyor)";
  }
  return CODE_RE.test(b) ? null : "Barkod en fazla 40 karakter; yalnızca harf, rakam, nokta, alt çizgi ve tire (boşluk yok)";
}

const skuField = z.string({ required_error: "SKU gerekli" }).trim()
  .regex(SKU_RE, "SKU 2-64 karakter; yalnızca harf, rakam, nokta, alt çizgi ve tire (boşluk ve başka özel karakter yok)");

// "" / null / undefined -> null; "12,5" -> 12.5
const optNumber = z.preprocess(
  (v) => (v === "" || v == null ? null : typeof v === "string" ? Number(v.replace(",", ".")) : v),
  z.number({ invalid_type_error: "Sayı olmalı" }).finite("Sayı olmalı").nonnegative("Negatif olamaz").nullable(),
);
const textMap = z.record(z.string(), z.string().max(500)).default({});

export const variantSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  sku: skuField,
  barcode: z.string().trim().nullable().optional().transform((v) => v || null)
    .superRefine((v, ctx) => { const e = barcodeError(v); if (e) ctx.addIssue({ code: z.ZodIssueCode.custom, message: e }); }),
  attributes: textMap,
  stock: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number({ invalid_type_error: "Stok sayı olmalı" }).int("Stok tam sayı olmalı").min(0, "Stok negatif olamaz")),
  cost_price: optNumber,
});

export const productSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  sku: skuField,
  title: z.string({ required_error: "Başlık gerekli" }).trim().min(2, "Başlık en az 2 karakter").max(300, "Başlık en fazla 300 karakter"),
  description: z.string().max(30000, "Açıklama en fazla 30.000 karakter").default(""),
  brand: z.string().trim().max(100, "Marka en fazla 100 karakter").default(""),
  category: z.string().trim().max(200, "Kategori en fazla 200 karakter").default(""),
  vat_rate: z.preprocess((v) => (v === "" || v == null ? 20 : Number(v)), z.number().refine((n) => (VAT_RATES as readonly number[]).includes(n), "KDV 0, 1, 10 veya 20 olmalı")),
  desi: optNumber,
  cost_price: optNumber,
  currency: z.enum(CURRENCIES).default("TRY"),
  status: z.enum(STATUSES, { errorMap: () => ({ message: "Durum taslak, aktif veya arşiv olmalı" }) }).default("draft"),
  attributes: textMap,
  images: z.array(z.string().trim().url("Geçerli bir adres değil").startsWith("https://", "Görsel adresi https:// ile başlamalı"))
    .max(20, "En fazla 20 görsel").default([]),
  variants: z.array(variantSchema).min(1, "En az bir varyant gerekli").max(200, "En fazla 200 varyant"),
}).superRefine((p, ctx) => {
  const seen = new Map<string, number>();
  p.variants.forEach((v, i) => {
    for (const [key, val] of [["sku", v.sku], ["barcode", v.barcode]] as const) {
      if (!val) continue;
      const k = key + ":" + val.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variants", i, key], message: `${key === "sku" ? "SKU" : "Barkod"} bu üründe tekrar ediyor (${seen.get(k)! + 1}. varyantla aynı)` });
      else seen.set(k, i);
    }
  });
});

export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;

// Hataları alan yoluna göre düz liste: { "variants.0.barcode": "..." }
export function issuesByPath(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) { const k = i.path.join(".") || "_"; if (!out[k]) out[k] = i.message; }
  return out;
}
