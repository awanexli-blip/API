// SSRF koruması: iç adresler, IPv6 biçimleri, yönlendirme, gövde sınırı (yerel sahte sunucuyla, dış ağ yok)
// node --experimental-strip-types worker/test/safe-fetch.test.ts
import { createServer } from "node:http";
import { blockedIp, checkUrl, safeFetch } from "../core/safe-fetch.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const rejects = async (p: Promise<unknown>) => p.then(() => false, () => true);

for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "ff02::1"])
  check(`engelli ${ip}`, blockedIp(ip));
for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "172.32.0.1"]) check(`açık ${ip}`, !blockedIp(ip));

check("localhost reddedilir", await rejects(checkUrl("http://localhost/x")));
check("metadata adı reddedilir", await rejects(checkUrl("http://metadata.google.internal/")));
check("ftp reddedilir", await rejects(checkUrl("ftp://example.com/")));
check("IPv6 köşeli iç adres", await rejects(checkUrl("http://[::1]:8080/")));
check("ondalık IP (2130706433) reddedilir", await rejects(checkUrl("http://2130706433/")));
check("kullanıcı:parola reddedilir", await rejects(checkUrl("https://a:b@example.com/")));

// Yerel sunucu (127.0.0.1) doğrudan zaten engelli: sahte sunucuya doğrudan istek de reddedilmeli
const srv = createServer((req, res) => {
  if (req.url === "/yonlendir") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }); return res.end(); }
  res.writeHead(200, { "content-type": "text/xml" }); res.end("<a/>");
}).listen(0);
const port = (srv.address() as any).port;
check("yerel sunucuya doğrudan istek reddedilir", await rejects(safeFetch(`http://127.0.0.1:${port}/`, { maxBytes: 1000, timeoutMs: 2000 })));
srv.close();
if (fails) { console.log(`\n${fails} SSRF testi başarısız`); process.exit(1); }
console.log("\nSSRF testleri geçti");
