export const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Eksik ortam değişkeni: ${k}`);
  return v;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
export const num = (v: any) => Number(String(v ?? "0").replace(",", "."));

// Barkod için ASCII dışı karakterleri at
export const san = (v: string) => v.replace(/[^A-Za-z0-9._\-]/g, "");
// Başlık karşılaştırması (çoklama koruması)
export const normTitle = (v: string) => v.toLocaleLowerCase("tr").replace(/[^0-9a-zçğıöşü]+/g, " ").trim().slice(0, 50);

// Komut satırı argümanı doğrulama (workflow girdileri buraya gelir): izinli değilse süreç hata ile durur
export const arg = (v: string | undefined, fallback: string, allowed: readonly string[] | RegExp, name: string) => {
  const x = v ?? fallback;
  const ok = Array.isArray(allowed) ? allowed.includes(x) : (allowed as RegExp).test(x);
  if (!ok) throw new Error(`Geçersiz ${name}: ${JSON.stringify(x).slice(0, 40)}`);
  return x;
};
export const MODES = ["preview", "update", "create", "auto"] as const;
export const MARKETPLACES = ["trendyol", "hepsiburada", "amazon"] as const;
export const SUPPLIER_ARG = /^(all|nightly|[a-z0-9-]{2,30})$/;

// Müşteri verisi maskeleme (günlük ve hata mesajlarında açık veri olmaz; Faz 6)
export const maskPhone = (v?: string | null) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length < 4 ? "***" : `***${d.slice(-2)}`; };
export const maskEmail = (v?: string | null) => { const [u, h] = String(v ?? "").split("@"); return h ? `${u.slice(0, 1)}***@${h}` : "***"; };
export const maskName = (v?: string | null) => String(v ?? "").trim().split(/\s+/).filter(Boolean).map((w) => w.slice(0, 1) + "***").join(" ") || "***";
export const maskAddress = (v?: string | null) => { const s = String(v ?? "").trim(); return s ? `${s.split(/[\s,]+/).slice(-1)[0]} (adres gizli)` : "***"; };
// CSV hücresi: ayraç/satır sonu temizlenir, formül gibi başlayan hücre (= + - @ sekme CR) Excel'de çalışmasın diye ' ile başlar
export const csvCell = (v: unknown) => { const s = String(v ?? "").replace(/;/g, ",").replace(/\r?\n/g, " "); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
