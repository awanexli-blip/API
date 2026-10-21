import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/worker/core/safe-fetch";
import { randomUUID } from "crypto";
import { admin } from "@/lib/server";
import { authorize } from "@/lib/products";

export const dynamic = "force-dynamic";

const BUCKET = "product-images"; // migration 005, herkese açık okuma
const MAX = 10 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Görsel yükle: FormData "file" (birden çok) veya JSON { url } (başka sitedeki görseli kendi depomuza kopyala).
// Dönüş: { urls: [...] } kalıcı https adresleri; pazaryerleri görseli buradan indirir.
export async function POST(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;

  const files: { type: string; data: ArrayBuffer }[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    for (const f of form.getAll("file")) if (f instanceof Blob) files.push({ type: f.type, data: await f.arrayBuffer() });
  } else {
    const { url } = await req.json().catch(() => ({}));
    const r = await fetchImage(String(url ?? ""));
    if (typeof r === "string") return NextResponse.json({ error: r }, { status: 400 });
    files.push(r);
  }
  if (!files.length || files.length > 20) return NextResponse.json({ error: "1-20 görsel gönder" }, { status: 400 });

  const db = admin();
  const urls: string[] = [];
  for (const f of files) {
    if (!EXT[f.type]) return NextResponse.json({ error: `Desteklenmeyen dosya türü (${f.type || "bilinmiyor"}). JPG, PNG veya WEBP yükle.` }, { status: 400 });
    if (f.data.byteLength > MAX) return NextResponse.json({ error: "Görsel en fazla 10 MB olmalı" }, { status: 400 });
    const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${EXT[f.type]}`;
    const { error } = await db.storage.from(BUCKET).upload(path, f.data, { contentType: f.type, upsert: false });
    if (error) return NextResponse.json({ error: `Yükleme hatası: ${error.message}` }, { status: 500 });
    urls.push(db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }
  return NextResponse.json({ urls });
}

// SSRF koruması ve 10 MB akış sınırı: worker/core/safe-fetch.ts
async function fetchImage(url: string) {
  try {
    const r = await safeFetch(url, { maxBytes: MAX, timeoutMs: 15000 });
    if (!r.ok) return `Görsel indirilemedi (HTTP ${r.status}). Görsele sağ tıklayıp "Resim adresini kopyala" ile doğrudan adresi al.`;
    if (!EXT[r.contentType]) return `Bu adres bir görsel değil (${r.contentType || "tür yok"}). Sayfa adresi değil, görselin kendi adresini yapıştır.`;
    const data = r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength) as ArrayBuffer;
    return { type: r.contentType, data };
  } catch (e: any) { return `Görsel indirilemedi: ${e.message}`; }
}
