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
