// Dış adrese güvenli istek (SSRF koruması). Panel (@/worker/core/safe-fetch) ve worker aynı dosyayı kullanır.
// 1) yalnızca http/https  2) ad DNS ile çözülür, çözülen HER adres iç/özel ağ ise reddedilir
// 3) yönlendirmeler elle izlenir (en fazla 3), her adımda yeniden doğrulanır  4) süre sınırı
// 5) gövde akışla sayılır, sınır aşılınca iptal  6) istenirse içerik türü kontrolü
// Not: çözümleme ile bağlantı arasındaki DNS değişimi (rebinding) bu katmanda tam kapanmaz; iç adrese yönlendirme ve doğrudan iç ad kapanır.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SafeFetchError extends Error {}

const v4 = (ip: string) => ip.split(".").map(Number);
const inV4 = (ip: string, base: string, bits: number) => {
  const a = v4(ip), b = v4(base);
  const n = (x: number[]) => ((x[0] << 24) >>> 0) + (x[1] << 16) + (x[2] << 8) + x[3];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((n(a) & mask) >>> 0) === ((n(b) & mask) >>> 0);
};
const V4_BLOCK: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

// IPv6 adresini 8 adet 16 bitlik parçaya aç (sonu IPv4 olabilir)
function v6parts(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const m = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (m) { const q = m.slice(1).map(Number); s = s.slice(0, m.index) + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16); }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const hex = (x: string) => (x ? x.split(":").map((g) => parseInt(g, 16)) : []);
  const h = hex(halves[0]), t = halves.length === 2 ? hex(halves[1]) : [];
  if ([...h, ...t].some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
  if (halves.length === 1) return h.length === 8 ? h : null;
  const fill = 8 - h.length - t.length;
  return fill < 1 ? null : [...h, ...Array(fill).fill(0), ...t];
}

export function blockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return V4_BLOCK.some(([b, n]) => inV4(ip, b, n));
  if (fam !== 6) return true;
  const p = v6parts(ip);
  if (!p || p.length !== 8) return true;
  const embedded = `${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`;
  if (p.slice(0, 7).every((x) => x === 0)) return p[7] <= 1 || blockedIp(embedded); // ::, ::1, ::a.b.c.d
  if (p.slice(0, 5).every((x) => x === 0) && p[5] === 0xffff) return blockedIp(embedded); // ::ffff:a.b.c.d
  if (p[0] === 0x64 && p[1] === 0xff9b && p.slice(2, 6).every((x) => x === 0)) return blockedIp(embedded); // NAT64
  if ((p[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((p[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((p[0] & 0xff00) === 0xff00) return true; // çok noktaya yayın
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // belge adresi
  return false;
}

const BAD_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata|metadata\.google\.internal)$/i;

export async function checkUrl(raw: string | URL): Promise<URL> {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new SafeFetchError("Geçerli bir adres değil"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("Adres http(s) ile başlamalı");
  if (u.username || u.password) throw new SafeFetchError("Adreste kullanıcı adı/parola olamaz");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (BAD_HOST.test(host)) throw new SafeFetchError("Bu adrese erişilemez");
  const ips = isIP(host) ? [host] : await lookup(host, { all: true, verbatim: true }).then((r) => r.map((x) => x.address)).catch(() => { throw new SafeFetchError("Adres çözülemedi (alan adı yok)"); });
  if (!ips.length || ips.some(blockedIp)) throw new SafeFetchError("Bu adrese erişilemez");
  return u;
}

export type SafeResponse = { status: number; ok: boolean; url: string; contentType: string; body: Buffer; text: () => string };

// method/body: tedarikçi REST API'leri (POST ile ürün listesi, OAuth2 belirteç). POST yönlendirmesi yalnızca 307/308'de izlenir (gövde korunur).
export async function safeFetch(raw: string | URL, opts: { maxBytes: number; timeoutMs: number; maxRedirects?: number; accept?: RegExp; headers?: Record<string, string>; method?: "GET" | "POST"; body?: string }): Promise<SafeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    let u = await checkUrl(raw);
    for (let hop = 0; ; hop++) {
      const method = opts.method ?? "GET";
      const r = await fetch(u, { method, body: method === "POST" ? opts.body : undefined, redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (urun-paneli)", ...(opts.headers ?? {}) } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        if (method === "POST" && r.status !== 307 && r.status !== 308) { await r.body?.cancel().catch(() => {}); throw new SafeFetchError(`POST isteği yönlendirildi (HTTP ${r.status})`); }
        await r.body?.cancel().catch(() => {});
        if (hop >= (opts.maxRedirects ?? 3)) throw new SafeFetchError("Çok fazla yönlendirme");
        u = await checkUrl(new URL(r.headers.get("location")!, u));
        continue;
      }
      const contentType = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (r.ok && opts.accept && !opts.accept.test(contentType)) { await r.body?.cancel().catch(() => {}); throw new SafeFetchError(`Beklenmeyen içerik türü (${contentType || "yok"})`); }
      if (Number(r.headers.get("content-length") ?? 0) > opts.maxBytes) { await r.body?.cancel().catch(() => {}); throw new SafeFetchError(`Dosya çok büyük (en fazla ${Math.round(opts.maxBytes / 1048576)} MB)`); }
      const parts: Uint8Array[] = [];
      let size = 0;
      if (r.body) {
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > opts.maxBytes) { await reader.cancel().catch(() => {}); throw new SafeFetchError(`Dosya çok büyük (en fazla ${Math.round(opts.maxBytes / 1048576)} MB)`); }
          parts.push(value);
        }
      }
      const body = Buffer.concat(parts);
      return { status: r.status, ok: r.ok, url: u.toString(), contentType, body, text: () => body.toString("utf8") };
    }
  } catch (e: any) {
    if (e instanceof SafeFetchError) throw e;
    if (ctrl.signal.aborted) throw new SafeFetchError(`Zaman aşımı (${Math.round(opts.timeoutMs / 1000)} sn)`);
    throw new SafeFetchError(`İndirilemedi: ${e?.cause?.code ?? e?.message ?? "bilinmeyen hata"}`);
  } finally { clearTimeout(timer); }
}
