// Hepsiburada test aracı (entegrasyon testi ve canlıya geçiş için). GitHub Actions > "Hepsiburada test aracı" ile çalışır.
// node --experimental-strip-types worker/hb-tool.ts <komut> [argümanlar]
//   ping                         kimlik doğrulama ve uç erişimi
//   categories <arama>           yaprak kategorilerde arama (tam liste hb_categories.csv)
//   suggest                      XML kategorilerine en uygun HB kategorileri (hb_category_suggestions.csv)
//   attributes <kategoriId>      kategori özellikleri (zorunlu olanlar ve değerleri)
//   send <adet> <kategoriId> [filtre]   ürün veritabanından (Toptancım vb.) ürün gönder, takip numarası ve sonucu yazar
//   status <takipNo>             ürün gönderim sonucu
//   listings [adet]              mağazadaki listing'ler
//   stock <merchantSku> <adet>   stok güncelle (ve sonucu kontrol et)
//   price <merchantSku> <fiyat>  fiyat güncelle (ve sonucu kontrol et)
//   orders                       siparişler (uç doğrulanacak)
//   raw <GET|POST> <mpop|listing|oms> <yol> [json]     serbest istek (test sırasında uç/alan denemek için)
// Ortam: HB_MERCHANT_ID, HB_USERNAME, HB_PASSWORD, HB_ENV (boş = test/SIT, prod = canlı), XML_URL, SUPABASE_*.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { calcPrice } from "./pricing.ts";
import { env, num, san } from "./core/util.ts";
import { loadXml } from "./core/xml.ts";
import { createHepsiburada, firstArray, hbAttributeValues, hbCategoryAttributes, hbClient } from "./marketplaces/hepsiburada.ts";
import type { NewProduct } from "./marketplaces/types.ts";

const [cmd = "ping", ...args] = process.argv.slice(2);
const c = hbClient();
const out: any = { command: cmd, args, env: c.prod ? "prod" : "sit", merchant: c.MERCHANT, at: new Date().toISOString() };
const log = (title: string, data?: unknown) => {
  console.log(`\n=== ${title}`);
  if (data !== undefined) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 1).slice(0, 8000));
  (out.steps ??= []).push({ title, data });
};
const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
const csvq = (v: unknown) => String(v ?? "").replace(/;/g, ",").replace(/\r?\n/g, " ");

async function allCategories() {
  const cats: { id: string; name: string; path: string }[] = [];
  for (let page = 0; page < 60; page++) {
    const r = await c.hb(`${c.MPOP}/product/api/categories/get-all-categories?leaf=true&status=ACTIVE&available=true&version=1&page=${page}&size=1000`);
    const list = firstArray(r);
    for (const x of list) cats.push({ id: String(x.categoryId ?? x.id), name: String(x.name ?? x.displayName ?? ""), path: (x.paths ?? x.path ?? []).join?.(" > ") ?? String(x.paths ?? "") });
    const total = Number(r.totalPages ?? r.data?.totalPages ?? NaN);
    if (!list.length || (Number.isFinite(total) && page + 1 >= total) || list.length < 1000) break;
  }
  writeFileSync("hb_categories.csv", "﻿id;ad;yol\n" + cats.map((x) => [x.id, x.name, x.path].map(csvq).join(";")).join("\n"), "utf8");
  return cats;
}

async function settings() {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: base } = await db.from("settings").select("*").eq("id", 1).single();
  const { data: ms } = await db.from("marketplace_settings").select("*").eq("marketplace", "hepsiburada").maybeSingle();
  const s: any = { ...base };
  for (const [k, v] of Object.entries(ms ?? {})) if (v != null) s[k] = v;
  return s;
}

async function main() {
  if (cmd === "ping") {
    try { const r = await c.hb(`${c.LISTING}/listings/merchantid/${c.MERCHANT}?offset=0&limit=1`); log("listing erişimi: TAMAM", r); } catch (e: any) { log("listing erişimi: HATA", e.message); }
    try { const r = await c.hb(`${c.MPOP}/product/api/categories/get-all-categories?leaf=true&status=ACTIVE&available=true&version=1&page=0&size=2`); log("katalog (mpop) erişimi: TAMAM", r); } catch (e: any) { log("katalog erişimi: HATA", e.message); }
    // Kimlik biçimi teşhisi: Hepsiburada dokümanı kapalı, kaynaklar çelişiyor. Olası birleşimleri dene (gizli değerler yazılmaz, yalnızca etiket)
    const M = c.MERCHANT, U = process.env.HB_USERNAME ?? "", P = process.env.HB_PASSWORD ?? "", UA = process.env.HB_USER_AGENT ?? "";
    const combos: [string, string, string, string][] = [
      ["kullanıcı adı : şifre, UA = kullanıcı adı", U, P, U],
      ["mağaza ID : şifre, UA = kullanıcı adı", M, P, U],
      ["mağaza ID : şifre, UA = '<mağaza ID> - SelfIntegration'", M, P, `${M} - SelfIntegration`],
      ["kullanıcı adı : şifre, UA = '<mağaza ID> - SelfIntegration'", U, P, `${M} - SelfIntegration`],
      ...(UA ? [["kullanıcı adı : şifre, UA = HB_USER_AGENT", U, P, UA], ["mağaza ID : şifre, UA = HB_USER_AGENT", M, P, UA]] as [string, string, string, string][] : []),
    ];
    log("ayar kontrolü (değerler gizli)", {
      HB_USER_AGENT_tanımlı: !!UA, HB_USER_AGENT_uzunluk: UA.length,
      HB_USERNAME_mağaza_ID_ile_aynı: U.trim() === M.trim(),
      boşluk_var: [M, U, P, UA].some((v) => v !== v.trim()),
    });
    const result: Record<string, string> = {};
    const urls: [string, string][] = [["listing", `${c.LISTING}/listings/merchantid/${M}?offset=0&limit=1`], ["katalog", `${c.MPOP}/product/api/categories/get-all-categories?leaf=true&status=ACTIVE&available=true&version=1&page=0&size=1`]];
    for (const [label, user, pass, ua] of combos) {
      const parts: string[] = [];
      for (const [name, url] of urls) {
        try {
          const res = await fetch(url, { headers: { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"), "User-Agent": ua, Accept: "application/json" } });
          parts.push(`${name}: ${res.ok ? "ÇALIŞIYOR" : `HTTP ${res.status}`}`);
        } catch (e: any) { parts.push(`${name}: bağlantı hatası`); }
      }
      result[label] = parts.join(" · ");
    }
    log("kimlik biçimi teşhisi", result);
    const ok = Object.entries(result).find(([, v]) => v.includes("ÇALIŞIYOR"));
    log(ok ? `✓ Çalışan biçim: ${ok[0]}` : "✗ Hiçbir biçim çalışmadı: bilgileri ve ortamı (sit/prod) kontrol et");
    return;
  }

  if (cmd === "categories") {
    const q = lo(args.join(" "));
    const cats = await allCategories();
    log(`toplam yaprak kategori: ${cats.length} (hb_categories.csv)`);
    log(`"${q}" araması`, cats.filter((x) => lo(x.name + " " + x.path).includes(q)).slice(0, 60));
    return;
  }

  if (cmd === "suggest") {
    const cats = await allCategories();
    const words = (s: string) => (lo(s).match(/[0-9a-zçğıöşü]+/g) ?? []).filter((w) => w.length > 2).map((w) => w.slice(0, 5));
    const catTok = cats.map((x) => ({ ...x, t: new Set(words(x.name + " " + x.path)), n: new Set(words(x.name)) }));
    const raw = await loadXml();
    const byXml = new Map<string, string[]>();
    for (const r of raw) { const k = String(r.category ?? ""); const l = byXml.get(k) ?? []; if (l.length < 30) l.push(String(r.name ?? "")); byXml.set(k, l); }
    const rows: string[] = ["xml_kategori;oneri1_id;oneri1;puan1;oneri2_id;oneri2;oneri3_id;oneri3"];
    const preview: any[] = [];
    for (const [xc, titles] of byXml) {
      const leaf = xc.split(">>>").pop() ?? xc;
      const q = [...words(leaf).map((w) => [w, 3] as const), ...words(titles.join(" ")).map((w) => [w, 0.2] as const)];
      const scored = catTok.map((x) => ({ x, s: q.reduce((t, [w, wt]) => t + (x.n.has(w) ? wt * 1.5 : x.t.has(w) ? wt : 0), 0) })).filter((z) => z.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
      rows.push([xc, ...scored.flatMap((z, i) => (i === 0 ? [z.x.id, z.x.path || z.x.name, z.s.toFixed(1)] : [z.x.id, z.x.path || z.x.name]))].map(csvq).join(";"));
      if (preview.length < 40) preview.push({ xml: xc, oneri: scored.map((z) => `${z.x.id} ${z.x.name}`) });
    }
    writeFileSync("hb_category_suggestions.csv", "﻿" + rows.join("\n"), "utf8");
    log(`${byXml.size} XML kategorisi için öneri (hb_category_suggestions.csv)`, preview);
    return;
  }

  if (cmd === "attributes") {
    const id = args[0];
    const attrs = await hbCategoryAttributes(c, id);
    const res: any[] = [];
    for (const a of attrs) {
      let values: string[] = [];
      if (a.mandatory && a.group !== "base") { try { values = (await hbAttributeValues(c, id, a.id)).slice(0, 25); } catch { /* serbest metin */ } }
      res.push({ ...a, values });
    }
    log(`kategori ${id}: ${attrs.length} özellik, zorunlu: ${attrs.filter((a) => a.mandatory).length}`, res);
    return;
  }

  if (cmd === "send") {
    const n = Math.max(1, Number(args[0] || 1));
    const categoryId = args[1];
    const filter = lo(args.slice(2).join(" "));
    if (!categoryId) throw new Error("kullanım: send <adet> <hbKategoriId> [başlık/kategori filtresi]");
    const s = await settings();
    const mp = createHepsiburada();
    const existing = new Set((await mp.loadListings()).map((l) => l.id));
    const minStock = Number(s.min_stock ?? 5);
    const cfg = {
      commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate), shippingCost: Number(s.shipping_cost),
      freeShippingThreshold: Number(s.free_shipping_threshold), minMarkup: Number(s.min_markup), fixedCost: Number(s.fixed_cost),
      returnRate: Number(s.return_rate ?? 0), returnCost: Number(s.return_cost ?? 0), squeezeMinNet: s.squeeze_min_net != null ? Number(s.squeeze_min_net) : null, multiUnitMinNet: s.multi_unit_min_net != null ? Number(s.multi_unit_min_net) : null,
      minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price),
      commissionPlusVat: s.commission_plus_vat === true, shippingVatIncluded: s.shipping_vat_included !== false, vatRate: Number(s.vat_rate ?? 20) / 100,
    };
    // Kaynak: ürün veritabanı (aktif tedarikçiler; BayilikXML bırakıldı). Başlığında bilinen marka geçen ürünler atlanır (marka ihlali)
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const BRANDS = /(philips|samsung|xiaomi|apple|iphone|sony|bosch|tefal|arzum|karaca|nike|adidas|puma|disney|marvel|barbie|lego|hasbro|mattel|pok[eé]mon|stanley|dyson|braun|remington|rowenta|fakir|sinbo|casio|swarovski|pandora|hello kitty|paw patrol|spider-?man|frozen|sonic|minecraft|fisher price|tupperware|emsan|korkmaz|pa[sş]abah[cç]e|huawei|lenovo|anker|baseus|jbl|logitech|hoco|ugreen|ally|duzzona|uslion)/i;
    const picked: NewProduct[] = [];
    for (let from = 0; picked.length < n && from < 20000; from += 500) {
      const { data, error } = await db.from("products").select("id, sku, title, description, category, desi, cost_price, vat_rate, source, product_variants(sku, barcode, stock, cost_price), product_images(url, position)")
        .eq("status", "active").neq("source", "xml:bayilik").order("created_at").range(from, from + 499);
      if (error) throw new Error("ürünler okunamadı: " + error.message);
      if (!data?.length) break;
      for (const p of data as any[]) {
        if (picked.length >= n) break;
        const v = p.product_variants?.[0];
        const id = String(v?.sku ?? p.sku ?? "");
        const images = [...(p.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => String(i.url));
        if (!id || existing.has(id) || !images.length || Number(v?.stock ?? 0) < minStock || BRANDS.test(p.title)) continue;
        if (filter && !lo(`${p.title} ${p.category ?? ""}`).includes(filter)) continue;
        const desi = Math.max(1, Math.ceil(Number(p.desi) || Number(s.default_desi ?? 2)));
        const pcfg = { ...cfg, vatRate: Number(p.vat_rate ?? 20) / 100, ...(s.shipping_mode === "desi" ? { shippingCost: mp.shippingCost!(desi, s.cargo_carrier) } : {}) };
        const calc = calcPrice(Number(v?.cost_price ?? p.cost_price), pcfg);
        if (!calc.ok) continue;
        picked.push({ id, name: String(p.title), detail: String(p.description ?? p.title), brand: "", productCode: id, desi, images, cat: { category_id: categoryId, attributes: [] }, price: calc.price, qty: Number(v.stock) });
      }
    }
    log(`${picked.length} ürün seçildi`, picked.map((p) => ({ merchantSku: p.id, ad: p.name, fiyat: p.price, stok: p.qty, desi: p.desi })));
    const skipped: Record<string, number> = {};
    const res = await mp.createProducts(picked, { vatRate: Number(s.vat_rate ?? 20), skip: (w) => { skipped[w] = (skipped[w] ?? 0) + 1; } });
    log("gönderim", { gonderilen: res.ok, hataliPaket: res.failed, takipNo: res.batchIds, atlanan: skipped });
    if (res.batchIds.length) log("sonuç kontrolü", await mp.checkBatches!(res.batchIds));
    return;
  }

  if (cmd === "status") {
    const id = args[0];
    log(`ürün gönderim sonucu ${id}`, await c.hb(`${c.MPOP}/product/api/products/status/${id}`));
    return;
  }

  if (cmd === "listings") {
    const n = Number(args[0] || 10);
    log(`ilk ${n} listing`, await c.hb(`${c.LISTING}/listings/merchantid/${c.MERCHANT}?offset=0&limit=${n}`));
    return;
  }

  if (cmd === "stock" || cmd === "price") {
    const [sku, value] = args;
    if (!sku || value == null) throw new Error(`kullanım: ${cmd} <merchantSku> <değer>`);
    const mp = createHepsiburada();
    const item = cmd === "stock" ? { id: sku, price: null, quantity: Number(value) } : { id: sku, price: Number(value), quantity: NaN };
    let res;
    if (cmd === "price") {
      const r = await c.hb(`${c.LISTING}/listings/merchantid/${c.MERCHANT}/price-uploads`, { method: "POST", body: JSON.stringify([{ merchantSku: sku, price: Number(value) }]) });
      res = { batchIds: ["price:" + c.trackingId(r)], raw: r };
    } else res = await mp.pushInventory([item as any]);
    log(`${cmd} gönderildi`, res);
    log("sonuç kontrolü", await mp.checkBatches!(res.batchIds));
    return;
  }

  if (cmd === "orders") {
    for (const path of [`/orders/merchantid/${c.MERCHANT}?offset=0&limit=10`, `/packages/merchantid/${c.MERCHANT}?offset=0&limit=10`]) {
      try { log(`OMS ${path}`, await c.hb(`${c.OMS}${path}`)); } catch (e: any) { log(`OMS ${path}: HATA`, e.message); }
    }
    return;
  }

  if (cmd === "raw") {
    const [method, host, path, body] = args;
    const base = host === "listing" ? c.LISTING : host === "oms" ? c.OMS : c.MPOP;
    const url = `${base}${path.replace("{merchantId}", c.MERCHANT)}`;
    log(`${method} ${url}`, await c.hb(url, method === "POST" ? { method, body } : { method }));
    return;
  }

  throw new Error(`bilinmeyen komut: ${cmd}`);
}

main()
  .catch((e) => { log("HATA", String(e?.message ?? e)); process.exitCode = 1; })
  .finally(() => writeFileSync("hb_tool_output.json", JSON.stringify(out, null, 1), "utf8"));
