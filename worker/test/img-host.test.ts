// HB görsel düzeltme yardımcıları: neden ayrıştırma, görsel seçimi, dosya adı, JPEG çevirme (küçük görsel büyütülür, beyaz zemin)
// node --experimental-strip-types worker/test/img-host.test.ts
import { parseImageReasons, pickImages, hostedRel, hostedUrl, toJpeg } from "../core/img-host.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };

const r = parseImageReasons("Image1: Görseliniz erişim problemi nedeniyle indirilememiştir. · Image3: Ürün görselinde filigran kullanılmamalıdır. · Image4: +18 hassas içerik bulunan görseller kullanılmamalıdır · Image2: Görselinizin, piksel boyutu (250x250) den küçük boyuttadır. Daha büyük bir görsel ile tekrar deneyiniz.");
check("erişim", r.access.join() === "1", r);
check("küçük", r.small.join() === "2", r);
check("filigran", r.watermark.join() === "3", r);
check("hassas", r.sensitive.join() === "4", r);
check("görsel nedeni yoksa boş", parseImageReasons("Ürün Bilgileri Eksik").access.length === 0);

const urls = ["a", "b", "c", "d", "e", "f"];
const p = pickImages(urls, r);
check("filigranlı/hassas çıkarılır, en fazla 5", p.keep.join() === "a,b,e" && p.dropped.join() === "c,d", p);
check("hepsi kötüyse boş", pickImages(["a"], { access: [], small: [], watermark: [1], sensitive: [], other: [] }).keep.length === 0);

const rel = hostedRel("1a2b-3c", "https://x/y.webp");
check("dosya adı kararlı", rel === hostedRel("1a2b-3c", "https://x/y.webp") && /^1a2b-3c\/[0-9a-f]{20}\.jpg$/.test(rel), rel);
check("kaynak değişince yeni ad", rel !== hostedRel("1a2b-3c", "https://x/z.webp"));
check("güvensiz karakter atılır", hostedRel("../../etc", "u").startsWith("etc/"));
check("adres", hostedUrl(rel, "https://h/p") === `https://h/p/${rel}`);

const sharp = (await import("sharp")).default;
const small = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
const out = await toJpeg(small);
const m = await sharp(out.buf).metadata();
check("JPEG 1200x1200", m.format === "jpeg" && m.width === 1200 && m.height === 1200, m);
check("kaynak boyutu", out.w === 200 && out.h === 100, out);
const { data } = await sharp(out.buf).extract({ left: 600, top: 5, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
check("kenar beyaz zemin", data[0] > 245 && data[1] > 245 && data[2] > 245, [...data]);
check("üst veri yok", !m.exif && !m.icc, m);

if (fails) { console.log(`${fails} HATA`); process.exit(1); }
