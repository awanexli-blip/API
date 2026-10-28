// Supabase Storage yerine küçük görsel deposu: supabase-js storage.upload() ile uyumlu (POST/PUT /object/<kova>/<yol>).
// Okuma Caddy'den (/storage/v1/object/public/...) diskten yapılır. Yalnızca service_role JWT yazabilir.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, writeFile, access, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";

const SECRET = process.env.JWT_SECRET, DIR = process.env.STORAGE_DIR || "/data";
if (!SECRET || SECRET.length < 32) { console.error("JWT_SECRET yok/kısa"); process.exit(1); }
const BUCKETS = new Set(["product-images"]);
const MAX = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
function role(auth) {
  const t = (auth ?? "").replace(/^Bearer /, "").split(".");
  if (t.length !== 3) return null;
  const sig = createHmac("sha256", SECRET).update(`${t[0]}.${t[1]}`).digest();
  const got = b64(t[2]);
  if (got.length !== sig.length || !timingSafeEqual(got, sig)) return null;
  try {
    const p = JSON.parse(b64(t[1]).toString("utf8"));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p.role ?? null;
  } catch { return null; }
}
const safePath = (p) => p.split("/").every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== "." && s !== "..") ? p : null;
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX + 64 * 1024) throw new Error("büyük"); chunks.push(c); }
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/health") return send(res, 200, { ok: true });
    const m = u.pathname.match(/^\/object\/([^/]+)\/(.+)$/);
    if (!m || !["POST", "PUT", "DELETE"].includes(req.method)) return send(res, 404, { error: "not_found" });
    if (role(req.headers.authorization) !== "service_role") return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "service_role gerekli" });
    const bucket = m[1], path = safePath(decodeURIComponent(m[2]));
    if (!BUCKETS.has(bucket) || !path) return send(res, 400, { statusCode: "400", error: "InvalidKey", message: "geçersiz kova/yol" });
    const file = join(DIR, bucket, path);
    if (req.method === "DELETE") { await unlink(file).catch(() => {}); return send(res, 200, { message: "silindi" }); }

    let data = await readBody(req), type = String(req.headers["content-type"] ?? "").split(";")[0];
    if (type === "multipart/form-data") {
      const fd = await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: data }).formData();
      const f = [...fd.values()].find((v) => typeof v === "object");
      if (!f) return send(res, 400, { statusCode: "400", error: "NoFile", message: "dosya yok" });
      data = Buffer.from(await f.arrayBuffer()); type = f.type;
    }
    if (!TYPES.has(type)) return send(res, 415, { statusCode: "415", error: "InvalidMimeType", message: `desteklenmeyen tür ${type}` });
    if (data.length > MAX) return send(res, 413, { statusCode: "413", error: "Payload too large", message: "en fazla 10 MB" });
    const upsert = String(req.headers["x-upsert"]) === "true" || req.method === "PUT";
    if (!upsert && await access(file).then(() => true, () => false)) return send(res, 409, { statusCode: "409", error: "Duplicate", message: "dosya zaten var" });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    send(res, 200, { Key: `${bucket}/${path}`, Id: randomUUID() });
  } catch (e) {
    send(res, 500, { statusCode: "500", error: "internal", message: String(e?.message ?? e).slice(0, 200) });
  }
}).listen(5000, "0.0.0.0", () => console.log("depo hazır :5000"));
