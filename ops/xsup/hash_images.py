#!/usr/bin/env python3
"""Tedarikçiler arası eşleşme için ilk görselin algısal özeti (K 28.11, migration 104). K'nın bilgisayarında çalışır (ağır iş: yüzlerce MB indirme).

Sunucuda Pillow yok; bu araç sunucunun veritabanından bekleyenleri ssh+psql ile okur, görselleri indirir, pHash + dHash (64 bit, imagehash) hesaplar,
sonucu yine ssh+psql ile product_xkeys'e yazar. Pazaryerine hiçbir şey yazmaz. Kalıcı hata (404, bozuk görsel) ph='' ile işaretlenir (eşleşmez, tekrar denenmez).

  pip install pillow imagehash requests
  python ops/xsup/hash_images.py [--limit 5000] [--workers 24] [--host root@89.252.153.187] [--key ~/.ssh/trentakip_vps]
Önce sunucuda:  worker/xsup-groups.ts candidates   Sonra:  worker/xsup-groups.ts group
"""
import argparse, csv, io, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image
import imagehash

ap = argparse.ArgumentParser()
ap.add_argument("--limit", type=int, default=0)
ap.add_argument("--workers", type=int, default=24)
ap.add_argument("--host", default="root@89.252.153.187")
ap.add_argument("--key", default="~/.ssh/trentakip_vps")
a = ap.parse_args()
SSH = ["ssh", "-i", a.key.replace("~", __import__("os").path.expanduser("~")), a.host, "docker exec -i trentakip-db-1 psql -U postgres -v ON_ERROR_STOP=1"]


def psql(sql, stdin=None):
    for deneme in range(5):  # ssh bağlantısı yük altında kopabilir: yeniden dene (güncelleme tekrarlanabilir)
        r = subprocess.run(SSH[:4] + [SSH[4] + " -At"], input=(stdin or sql).encode(), capture_output=True)
        if not r.returncode:
            return r.stdout.decode()
        time.sleep(10 * (deneme + 1))
    sys.exit("psql hata: " + r.stderr.decode()[:500])


lim = f" limit {a.limit}" if a.limit else ""
out = psql(f"\\copy (select product_id, img_url from product_xkeys where ph is null and img_url is not null order by product_id{lim}) to stdout csv")
rows = list(csv.reader(io.StringIO(out)))
print(f"bekleyen {len(rows)}", flush=True)
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (xsup-hash)"


def work(r):
    pid, url = r
    try:
        res = S.get(url, timeout=(10, 20))
    except Exception:
        return pid, None, "transient"
    if res.status_code in (404, 410, 403):
        return pid, ("", ""), "gone"
    if res.status_code != 200 or len(res.content) > 12_000_000:
        return pid, None, "transient"
    try:
        im = Image.open(io.BytesIO(res.content)).convert("RGB")
        return pid, (str(imagehash.phash(im)), str(imagehash.dhash(im))), "ok"
    except Exception:
        return pid, ("", ""), "gone"


def flush(buf):
    if not buf:
        return
    data = "".join(f"{p},{ph},{dh}\n" for p, ph, dh in buf)
    sql = ("create temp table _h(product_id uuid, ph text, dh text);\n\\copy _h from stdin csv\n" + data + "\\.\n"
           "update product_xkeys k set ph = h.ph, dh = h.dh, hashed_at = now() from _h h where k.product_id = h.product_id;\n")
    psql(None, stdin=sql)


t0 = time.time(); done = 0; stat = {"ok": 0, "gone": 0, "transient": 0}; buf = []
with ThreadPoolExecutor(a.workers) as ex:
    for pid, h, st in ex.map(work, rows):
        stat[st] += 1; done += 1
        if h is not None:
            buf.append((pid, h[0], h[1]))
        if len(buf) >= 1000:
            flush(buf); buf = []
        if done % 1000 == 0:
            print(f"{done}/{len(rows)} {stat} {time.time()-t0:.0f}s", flush=True)
flush(buf)
print("bitti", stat, f"{time.time()-t0:.0f}s")
