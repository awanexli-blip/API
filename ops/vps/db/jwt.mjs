// Sunucu anahtarları: JWT_SECRET ile imzalı anon / service_role anahtarı (Supabase'deki ANON_KEY / SERVICE_ROLE_KEY karşılığı).
// node ops/vps/db/jwt.mjs <rol>   (JWT_SECRET ortamda; çıktı yalnızca anahtar, ekrana değil dosyaya yönlendir)
import { createHmac } from "node:crypto";
const secret = process.env.JWT_SECRET, role = process.argv[2];
if (!secret || secret.length < 32) { console.error("JWT_SECRET yok/kısa"); process.exit(1); }
if (!["anon", "service_role"].includes(role)) { console.error("rol: anon | service_role"); process.exit(2); }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "trentakip", role, iat: now, exp: now + 10 * 365 * 86400 })}`;
process.stdout.write(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`);
