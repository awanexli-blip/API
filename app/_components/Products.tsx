"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateEan13, generateSku, issuesByPath, productSchema } from "@/lib/validation/product";
import { readiness } from "@/lib/marketplace-readiness";
import { tl, when, type Api, type Notify, type Row } from "./shared";
import BrandInput from "./BrandInput";
import Icon from "./Icon";
import PricePreview from "./PricePreview";
import { calcPrice } from "@/worker/pricing";
import { applyRules, rulesFor, type PricingRule } from "@/worker/pricing-rules";
import { cfgFromSettings } from "./pricing-config";

type Role = "viewer" | "editor" | "admin";
const STATUS_TR: Record<string, string> = { draft: "Taslak", active: "Aktif", archived: "Arşiv" };
const LISTING_TR: Record<string, string> = { live: "yayında", pending_approval: "onay bekliyor", rejected: "reddedildi", closed: "kapalı", gone: "kalktı", queued: "sırada", sent: "gönderildi", error: "hata" };
const LISTING_PILL: Record<string, string> = { live: "ok", pending_approval: "partial", queued: "partial", sent: "info", rejected: "error", closed: "error", error: "error", gone: "" };
const ACTION_TR: Record<string, string> = { create: "oluşturuldu", update: "güncellendi", archive: "arşivlendi", delete: "silindi" };
const COLORS = ["Siyah", "Beyaz", "Gri", "Kırmızı", "Mavi", "Lacivert", "Yeşil", "Sarı", "Turuncu", "Pembe", "Mor", "Kahverengi", "Bej", "Gümüş", "Altın", "Çok Renkli", "Şeffaf"];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "Standart"];
const DESI = ["1", "2", "3", "4", "5", "8", "10", "15", "20"];

// "Renk: Kırmızı, Beden: M" <-> { Renk: "Kırmızı", Beden: "M" }
const toText = (o: Record<string, string> | undefined, sep = ", ") => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join(sep);
const toMap = (s: string) => Object.fromEntries(s.split(/[,\n]/).map((x) => x.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(":").trim()]));
const slug = (s: string) => s.toLocaleUpperCase("tr").replace(/Ç/g, "C").replace(/Ğ/g, "G").replace(/İ/g, "I").replace(/Ö/g, "O").replace(/Ş/g, "S").replace(/Ü/g, "U").replace(/[^A-Z0-9]+/g, "").slice(0, 8);

type VariantForm = { id?: string; sku: string; barcode: string; attrs: string; stock: string; cost_price: string; reserved?: number };
type Form = {
  id?: string; sku: string; title: string; description: string; brand: string; category: string;
  vat_rate: string; desi: string; cost_price: string; currency: string; status: string; attrs: string; images: string[]; variants: VariantForm[]; source?: string;
};
type Options = { brands: string[]; defaultBrand: string; sources?: { id: string; label: string }[]; categories: { name: string; markets: string[]; names: Record<string, string> }[] };
const emptyVariant = (): VariantForm => ({ sku: "", barcode: "", attrs: "", stock: "", cost_price: "" });
const emptyForm = (brand = ""): Form => ({ sku: "", title: "", description: "", brand, category: "", vat_rate: "20", desi: "1", cost_price: "", currency: "TRY", status: "active", attrs: "", images: [], variants: [emptyVariant()] });
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function fromProduct(p: Row): Form {
  return {
    id: p.id, sku: p.sku, title: p.title, description: p.description ?? "", brand: p.brand ?? "", category: p.category ?? "",
    vat_rate: s(p.vat_rate), desi: s(p.desi), cost_price: s(p.cost_price), currency: p.currency ?? "TRY", status: p.status,
    attrs: toText(p.attributes, "\n"), images: p.images ?? [], source: p.source,
    variants: (p.variants ?? []).map((v: Row) => ({ id: v.id, sku: v.sku, barcode: v.barcode ?? "", attrs: toText(v.attributes), stock: s(v.stock), cost_price: s(v.cost_price), reserved: v.reserved })),
  };
}
// Boş SKU ve barkodları doldur: kullanıcı yalnızca başlık, fiyat, stok girer
function autofill(f: Form): Form {
  const sku = f.sku.trim() || generateSku(f.title);
  const many = f.variants.length > 1;
  const used = new Set<string>();
  const variants = f.variants.map((v, i) => {
    let vs = v.sku.trim();
    if (!vs) {
      const tail = Object.values(toMap(v.attrs)).map(slug).filter(Boolean).join("-");
      vs = many ? `${sku}-${tail || i + 1}` : sku;
    }
    while (used.has(vs.toLowerCase())) vs = `${vs}-${i + 1}`;
    used.add(vs.toLowerCase());
    return { ...v, sku: vs.slice(0, 64), barcode: v.barcode.trim() || generateEan13(), stock: v.stock.trim() || "0" };
  });
  return { ...f, sku, variants };
}
function toPayload(f: Form) {
  return {
    sku: f.sku, title: f.title, description: f.description, brand: f.brand, category: f.category,
    vat_rate: f.vat_rate, desi: f.desi, cost_price: f.cost_price, currency: f.currency, status: f.status,
    attributes: toMap(f.attrs), images: f.images,
    variants: f.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, attributes: toMap(v.attrs), stock: v.stock, cost_price: v.cost_price })),
  };
}

export default function Products({ api, notify }: { api: Api; notify: Notify }) {
  const [role, setRole] = useState<Role>("viewer");
  const [editing, setEditing] = useState<Form | null>(null);
  const [opts, setOpts] = useState<Options>({ brands: [], defaultBrand: "", categories: [] });
  const [key, setKey] = useState(0); // yeni formda bileşeni sıfırlamak için
  useEffect(() => { api("/api/me").then((m) => setRole(m.role)).catch(() => {}); }, [api]);
  const loadOpts = useCallback(() => api("/api/products/options").then(setOpts).catch(() => {}), [api]);
  useEffect(() => { loadOpts(); }, [loadOpts]);
  const canEdit = role !== "viewer";

  const open = async (id?: string) => {
    if (!id) { setKey((k) => k + 1); return setEditing(emptyForm(opts.defaultBrand)); }
    try { setEditing(fromProduct(await api(`/api/products/${id}`))); setKey((k) => k + 1); } catch (e: any) { notify("err", e.message); }
  };
  // Kopya: aynı bilgiler, yeni SKU ve barkod
  const copy = (f: Form) => {
    setKey((k) => k + 1);
    setEditing({ ...f, id: undefined, sku: "", title: f.title, variants: f.variants.map((v) => ({ ...v, id: undefined, sku: "", barcode: "", reserved: undefined })) });
  };

  if (editing) return <Editor key={key} api={api} notify={notify} role={role} initial={editing} opts={opts}
    onClose={() => { setEditing(null); loadOpts(); }} onNew={() => { loadOpts(); open(); }} onCopy={copy} />;
  return <List api={api} notify={notify} canEdit={canEdit} onOpen={open} opts={opts} isAdmin={role === "admin"} />;
}

// "Trendyol'a gönder": kuyruğa al; yönetici isterse senkronu hemen başlat
async function sendToMarketplace(api: Api, notify: Notify, ids: string[], isAdmin: boolean, marketplace: "trendyol" | "amazon" = "trendyol") {
  const label = marketplace === "amazon" ? "Amazon" : "Trendyol";
  const now = isAdmin && confirm(`${ids.length} ürün ${label}'a gönderilsin mi?\n\nTamam: senkron hemen başlasın (birkaç dakika).\nİptal: sıraya alınsın, bir sonraki otomatik senkronda gönderilsin.`);
  try {
    const r = await api("/api/listings/send", { method: "POST", body: JSON.stringify({ product_ids: ids, marketplace, now }) });
    const extra = r.problems?.length ? ` Atlananlar: ${r.problems.slice(0, 3).join("; ")}${r.problems.length > 3 ? " ..." : ""}` : "";
    notify("good", `${r.products} ürün (${r.queued} varyant) ${label}'a gönderilmek üzere sıraya alındı${r.duplicate ? " (zaten sıradaydı)" : ""}. ${r.started ? "Senkron başlatıldı, sonuç birkaç dakika içinde ürün detayında görünür." : r.startError ? `Senkron başlatılamadı (${r.startError}); bir sonraki otomatik senkronda gönderilecek.` : "Bir sonraki senkronda gönderilecek."}${extra}`);
    return true;
  } catch (e: any) { notify("err", e.message); return false; }
}

// Vitrin: mağaza sayfası gibi büyük görsel ve fiyat. Fiyat = Trendyol ilanındaki fiyat; ilan yoksa ayarlar + akıllı kârla tahmini satış fiyatı.
const MP_TR: Record<string, string> = { trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon" };
function Gallery({ rows, canEdit, isAdmin, sel, toggle, onOpen, srcLabel, pricing }: {
  rows: Row[]; canEdit: boolean; isAdmin: boolean; sel: Set<string>; toggle: (id: string) => void; onOpen: (id?: string) => void; srcLabel: (s: string) => string; pricing: { s: Row; rules: PricingRule[] } | null;
}) {
  const estimate = (p: Row) => {
    if (!pricing || p.cost_price == null || (p.currency && p.currency !== "TRY")) return null;
    const cost = Number(p.cost_price);
    if (!(cost > 0)) return null;
    const cfg = cfgFromSettings(pricing.s, Number(p.vat_rate) || 20);
    const { cfg: rc } = applyRules(cfg, rulesFor(pricing.rules, "trendyol"), { cost, supplier: String(p.source ?? "").replace(/^xml:/, ""), category: p.category ?? "", brand: p.brand ?? "", stock: p.stock });
    const r = calcPrice(cost, rc, cfg.commissionRate);
    return r.ok ? { price: r.price, net: r.netProfit as number | null } : null;
  };
  return (
    <div className="shop-grid">
      {rows.map((p) => {
        const ty = (p.listings ?? []).find((l: Row) => l.mp === "trendyol");
        const live = ty && ty.price != null && Number(ty.price) > 0 ? { price: Number(ty.price), net: ty.net != null ? Number(ty.net) : null } : null;
        const price = live ?? estimate(p);
        const out = !(p.stock > 0);
        const [whole, frac] = price ? price.price.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(",") : ["", ""];
        return (
          <article key={p.id} className={`shop-card${sel.has(p.id) ? " picked" : ""}${p.status !== "active" ? " dim" : ""}`} onClick={() => onOpen(p.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(p.id); }}>
            <div className="shop-img">
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="shop-noimg"><Icon name="box" size={40} /></div>}
              {canEdit && <label className="shop-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Seç" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></label>}
              <div className="shop-badges">
                {out ? <span className="shop-badge bad">Tükendi</span> : p.stock < 3 ? <span className="shop-badge warn">Son {p.stock}</span> : null}
                {p.status !== "active" && <span className="shop-badge">{STATUS_TR[p.status]}</span>}
              </div>
              {p.images > 1 && <span className="shop-count">{p.images} görsel</span>}
            </div>
            <div className="shop-body">
              <div className="shop-brand">{p.brand || srcLabel(p.source)}</div>
              <h3 className="shop-title" title={p.title}>{p.title}</h3>
              <div className="shop-price">
                {price ? <><b>{whole}</b><span className="frac">,{frac}</span><span className="cur">TL</span></> : <span className="muted" style={{ fontSize: 14 }}>Fiyat yok</span>}
                {price && !live && <span className="shop-est" title="Trendyol'da ilanı yok; ayarlar ve akıllı kâr kurallarıyla hesaplanan satış fiyatı">tahmini</span>}
              </div>
              <div className="shop-meta">
                {isAdmin && price?.net != null && <span className={`shop-net${price.net >= 40 ? "" : " low"}`}>net +{Math.round(price.net)} TL</span>}
                {isAdmin && p.cost_price != null && <span className="muted">alış {p.currency && p.currency !== "TRY" ? `${p.cost_price} ${p.currency}` : tl(Number(p.cost_price))}</span>}
              </div>
              <div className="shop-foot">
                <span className={`dot ${out ? "bad" : "ok"}`} />{out ? "Stok yok" : `${p.stock} stok`}
                <span className="sp" />
                {(p.listings ?? []).map((l: Row) => <span key={l.mp} className={`pill ${LISTING_PILL[l.status] ?? ""}`} title={`${MP_TR[l.mp] ?? l.mp}: ${LISTING_TR[l.status] ?? l.status}`}>{LISTING_TR[l.status] ?? l.status}</span>)}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function List({ api, notify, canEdit, onOpen, opts, isAdmin }: { api: Api; notify: Notify; canEdit: boolean; onOpen: (id?: string) => void; opts: Options; isAdmin: boolean }) {
  // Filtreler bu oturumda hatırlanır (bölümler arası gidip gelince kaybolmasın)
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("productFilters") ?? "{}"); } catch { return {}; } })();
  const [q, setQ] = useState<string>(saved.q ?? "");
  const [status, setStatus] = useState<string>(saved.status ?? "active");
  const [source, setSource] = useState<string>(saved.source ?? "");
  const [stock, setStock] = useState<string>(saved.stock ?? "");
  const [page, setPage] = useState(0);
  const [res, setRes] = useState<{ rows: Row[]; total: number; size: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ kind: "brand" | "category"; value: string } | null>(null);
  const [sort, setSort] = useState<string>(saved.sort ?? "new");
  // Görünüm (vitrin / liste) bu tarayıcıda hatırlanır
  const [view, setView] = useState<"grid" | "list">(() => { try { return localStorage.getItem("productView") === "list" ? "list" : "grid"; } catch { return "grid"; } });
  const pickView = (v: "grid" | "list") => { setView(v); setPage(0); try { localStorage.setItem("productView", v); } catch {} };
  // Vitrinde tahmini Trendyol fiyatı için ayarlar + akıllı kâr kuralları (ilanı olmayan ürünlerde)
  const [pricing, setPricing] = useState<{ s: Row; rules: PricingRule[] } | null>(null);
  useEffect(() => { Promise.all([api("/api/settings?mp=trendyol"), api("/api/pricing-rules?mp=trendyol")]).then(([s, rules]) => setPricing({ s, rules })).catch(() => {}); }, [api]);

  const load = useCallback(async () => {
    try { sessionStorage.setItem("productFilters", JSON.stringify({ q, status, source, stock, sort })); } catch {}
    const p = new URLSearchParams({ page: String(page), size: view === "grid" ? "24" : "25", sort, ...(q ? { q } : {}), ...(status ? { status } : {}), ...(source ? { source } : {}), ...(stock ? { stock } : {}) });
    try { setRes(await api(`/api/products?${p}`)); } catch (e: any) { notify("err", e.message); }
  }, [api, notify, page, q, status, source, stock, sort, view]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setSel(new Set()); }, [q, status, source, stock, page]);
  const pages = res ? Math.max(1, Math.ceil(res.total / res.size)) : 1;
  const all = !!res?.rows.length && res.rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const filtered = !!(q || status || source || stock);
  const srcLabel = (s: string) => opts.sources?.find((x) => x.id === s)?.label ?? (s === "manual" ? "Elle" : s);

  async function runBulk(patch: Record<string, string>, label: string) {
    if (!confirm(`${sel.size} ürün için: ${label}. Devam edilsin mi?`)) return;
    try { const r = await api("/api/products/bulk", { method: "POST", body: JSON.stringify({ ids: [...sel], ...patch }) }); notify("good", `${r.updated} ürün güncellendi (${label}).`); setSel(new Set()); setBulk(null); load(); }
    catch (e: any) { notify("err", e.message); }
  }

  return (
    <>
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ position: "relative", flex: "1 1 240px" }}>
            <span style={{ position: "absolute", left: 10, top: 9, color: "var(--muted)" }}><Icon name="search" size={16} /></span>
            <input type="search" placeholder="Başlık veya SKU ara" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ paddingLeft: 34 }} />
          </div>
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }} style={{ flex: "0 1 180px" }} aria-label="Kaynak">
            <option value="">Tüm kaynaklar</option>{(opts.sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ flex: "0 1 150px" }} aria-label="Durum">
            <option value="">Tüm durumlar</option><option value="active">Aktif</option><option value="draft">Taslak</option><option value="archived">Arşiv</option>
          </select>
          <select value={stock} onChange={(e) => { setStock(e.target.value); setPage(0); }} style={{ flex: "0 1 150px" }} aria-label="Stok">
            <option value="">Tüm stoklar</option><option value="in">Stokta olan</option><option value="out">Stokta olmayan</option>
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} style={{ flex: "0 1 170px" }} aria-label="Sıralama">
            <option value="new">En yeni</option><option value="cost_desc">Fiyat: yüksekten</option><option value="cost_asc">Fiyat: düşükten</option><option value="title">Ada göre (A-Z)</option>
          </select>
          {filtered && <button className="btn ghost" onClick={() => { setQ(""); setStatus(""); setSource(""); setStock(""); setPage(0); }}>Temizle</button>}
          <div className="seg" role="group" aria-label="Görünüm">
            <button aria-pressed={view === "grid"} onClick={() => pickView("grid")}>▦ Vitrin</button>
            <button aria-pressed={view === "list"} onClick={() => pickView("list")}>☰ Liste</button>
          </div>
          {canEdit && <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => onOpen()}>+ Yeni ürün</button>}
        </div>
      </div>

      {canEdit && sel.size > 0 && <div className="card" style={{ padding: 12, borderColor: "var(--accent)" }}>
        <div className="row">
          <b>{sel.size} ürün seçili</b>
          <button className="btn" onClick={() => runBulk({ status: "active" }, "aktif yap")}>Aktif yap</button>
          <button className="btn" onClick={() => runBulk({ status: "draft" }, "taslağa al")}>Taslağa al</button>
          <button className="btn" onClick={() => runBulk({ status: "archived" }, "arşivle")}>Arşivle</button>
          <button className="btn primary" onClick={async () => { if (await sendToMarketplace(api, notify, [...sel], isAdmin)) setSel(new Set()); }}><Icon name="store" size={16} />Trendyol'a gönder</button>
          <button className="btn" onClick={async () => { if (await sendToMarketplace(api, notify, [...sel], isAdmin, "amazon")) setSel(new Set()); }}><Icon name="store" size={16} />Amazon'a gönder</button>
          <button className="btn" onClick={() => setBulk({ kind: "brand", value: opts.defaultBrand })}>Marka değiştir</button>
          <button className="btn" onClick={() => setBulk({ kind: "category", value: "" })}>Kategori değiştir</button>
          <button className="btn ghost" onClick={() => setSel(new Set())}>Seçimi kaldır</button>
        </div>
        {bulk && <div className="row" style={{ marginTop: 10 }}>
          <input type="text" list={bulk.kind === "category" ? "bulk-cats" : undefined} value={bulk.value} placeholder={bulk.kind === "brand" ? "Yeni marka" : "Yeni kategori"} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} style={{ flex: "1 1 240px" }} />
          <datalist id="bulk-cats">{opts.categories.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          <button className="btn primary" disabled={!bulk.value.trim()} onClick={() => runBulk({ [bulk.kind]: bulk.value.trim() }, `${bulk.kind === "brand" ? "marka" : "kategori"}: ${bulk.value.trim()}`)}>Uygula</button>
          <button className="btn" onClick={() => setBulk(null)}>Vazgeç</button>
        </div>}
        <small className="muted">Bu işlem yalnızca ürün veritabanını değiştirir; pazaryerindeki açık ilanların markası değişmez.</small>
      </div>}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <span className="muted">{res ? `${res.total.toLocaleString("tr-TR")} ürün` : "Yükleniyor..."}</span>
          {pages > 1 && <span className="muted" style={{ fontSize: 13 }}>Sayfa {page + 1} / {pages}</span>}
        </div>
        {!res ? <div><div className="skeleton" style={{ marginBottom: 10 }} /><div className="skeleton" style={{ width: "80%", marginBottom: 10 }} /><div className="skeleton" style={{ width: "60%" }} /></div> : res.rows.length === 0 ? (
          <div className="empty"><Icon name="box" size={32} /><p>{filtered ? "Filtreye uyan ürün yok." : "Henüz ürün yok."}</p>{!filtered && canEdit && <p className="muted" style={{ fontSize: 13 }}>"+ Yeni ürün" ile ekle, "İçe aktar"dan dosya yükle veya "Tedarikçiler"den XML al.</p>}</div>
        ) : view === "grid" ? (
          <Gallery rows={res.rows} canEdit={canEdit} isAdmin={isAdmin} sel={sel} toggle={toggle} onOpen={onOpen} srcLabel={srcLabel} pricing={pricing} />
        ) : (
          <div className="scroll"><table className="cards compact">
            <thead><tr>{canEdit && <th style={{ width: 32 }}><input type="checkbox" aria-label="Tümünü seç" checked={all} onChange={() => setSel(all ? new Set() : new Set(res.rows.map((r) => r.id)))} /></th>}<th /><th>Ürün</th><th>Kaynak</th><th className="n">Stok</th><th className="n">Maliyet</th><th>Durum</th><th>Güncelleme</th></tr></thead>
            <tbody>{res.rows.map((p) => (
              <tr key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: "pointer" }}>
                {canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Seç" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>}
                <td style={{ width: 52 }}>{p.image ? <img src={p.image} alt="" width={44} height={44} loading="lazy" style={{ objectFit: "cover", borderRadius: 8, display: "block" }} /> : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--panel-2)", display: "grid", placeItems: "center", color: "var(--muted)" }}><Icon name="box" size={18} /></div>}</td>
                <td data-label="Ürün" className="main"><b style={{ fontWeight: 600 }}>{p.title}</b><br /><span className="muted" style={{ fontSize: 12 }}>{p.sku}{p.brand ? ` · ${p.brand}` : ""}{p.category ? ` · ${String(p.category).slice(0, 60)}` : ""}</span>{p.variants > 1 && <span className="pill" style={{ marginLeft: 6 }}>{p.variants} seçenek</span>}</td>
                <td data-label="Kaynak" className="meta" style={{ fontSize: 13 }}>{srcLabel(p.source)}</td>
                <td data-label="Stok" className="n meta" style={{ color: p.stock > 0 ? undefined : "var(--bad)" }}>{p.stock}</td>
                <td data-label="Maliyet" className="n meta">{p.cost_price == null ? "-" : p.currency && p.currency !== "TRY" ? `${p.cost_price} ${p.currency}` : tl(Number(p.cost_price))}</td>
                <td data-label="Durum" className="meta"><span className={`pill ${p.status === "active" ? "ok" : p.status === "archived" ? "error" : "partial"}`}>{STATUS_TR[p.status]}</span></td>
                <td data-label="Güncelleme" className="muted hide-sm" style={{ fontSize: 13 }}>{when(p.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {pages > 1 && <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(0)}>«</button>
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Önceki</button>
          <span className="muted">{page + 1} / {pages}</span>
          <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Sonraki</button>
          <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(pages - 1)}>»</button>
        </div>}
      </div>
    </>
  );
}

function Editor({ api, notify, role, initial, opts, onClose, onNew, onCopy }: {
  api: Api; notify: Notify; role: Role; initial: Form; opts: Options; onClose: () => void; onNew: () => void; onCopy: (f: Form) => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [link, setLink] = useState("");
  const [audit, setAudit] = useState<Row[] | null>(null);
  const [listings, setListings] = useState<Row[] | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [hasVariants, setHasVariants] = useState(initial.variants.length > 1);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = role !== "viewer";
  const isNew = !f.id;
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setV = (i: number, k: keyof VariantForm, v: string) => setF((p) => ({ ...p, variants: p.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const err = (k: string) => (errs[k] ? <small style={{ color: "var(--bad)" }}>{errs[k]}</small> : null);

  useEffect(() => { if (f.id) api(`/api/products/${f.id}?audit=1`).then(setAudit).catch(() => setAudit([])); }, [api, f.id]);
  useEffect(() => { if (f.id) api(`/api/products/${f.id}?listings=1`).then(setListings).catch(() => setListings([])); }, [api, f.id]);

  const cat = opts.categories.find((c) => c.name === f.category);
  const ready = useMemo(() => readiness({
    title: f.title, description: f.description, brand: f.brand, category: f.category, desi: n(f.desi), cost_price: n(f.cost_price), images: f.images,
    // barkod kaydederken otomatik üretilir: boşsa hazır say
    variants: f.variants.map((v) => ({ barcode: v.barcode || "2000000000000", stock: Number(v.stock || 0), cost_price: n(v.cost_price) })),
  }, cat?.markets ?? []), [f, cat]);

  async function save(then?: "new" | "close") {
    const filled = autofill(f);
    const payload = toPayload(filled);
    const r = productSchema.safeParse(payload);
    if (!r.success) { setErrs(issuesByPath(r.error)); notify("err", "Formda hata var, kırmızı alanları düzelt."); return; }
    setErrs({}); setBusy(true);
    try {
      const saved = await api(isNew ? "/api/products" : `/api/products/${f.id}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) });
      notify("good", `${isNew ? "Ürün oluşturuldu" : "Ürün kaydedildi"}: ${saved.title} (SKU ${saved.sku})`);
      if (then === "new") return onNew();
      if (then === "close") return onClose();
      setF(fromProduct(saved));
      api(`/api/products/${saved.id}?audit=1`).then(setAudit).catch(() => {});
    } catch (e: any) { notify("err", e.message); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!confirm("Ürün arşivlensin mi? (Geri alınabilir: durumu tekrar Aktif yapıp kaydet.)")) return;
    try { await api(`/api/products/${f.id}`, { method: "DELETE" }); notify("good", "Ürün arşivlendi."); onClose(); } catch (e: any) { notify("err", e.message); }
  }
  async function hardDelete() {
    const typed = prompt(`Kalıcı silme geri alınamaz. Onaylamak için SKU'yu yaz: ${f.sku}`);
    if (typed == null) return;
    try { await api(`/api/products/${f.id}?hard=1&confirm=${encodeURIComponent(typed)}`, { method: "DELETE" }); notify("good", "Ürün kalıcı olarak silindi."); onClose(); } catch (e: any) { notify("err", e.message); }
  }

  // Görseller: dosya yükle / sürükle bırak / panodan yapıştır / link
  const addImages = (urls: string[]) => setF((p) => ({ ...p, images: [...p.images, ...urls.filter((u) => !p.images.includes(u))].slice(0, 20) }));
  async function upload(files: File[]) {
    const imgs = files.filter((x) => x.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploading((u) => u + imgs.length);
    for (const file of imgs) {
      try {
        const fd = new FormData(); fd.append("file", file);
        const r = await api("/api/products/images", { method: "POST", body: fd });
        addImages(r.urls);
      } catch (e: any) { notify("err", `${file.name}: ${e.message}`); }
      finally { setUploading((u) => u - 1); }
    }
  }
  async function addLink(copyToStore: boolean) {
    const urls = link.split(/\s+/).filter(Boolean);
    if (!urls.length) return;
    if (!copyToStore) {
      const bad = urls.find((u) => !u.startsWith("https://"));
      if (bad) return notify("err", `Link https:// ile başlamalı: ${bad.slice(0, 60)}`);
      addImages(urls); setLink(""); return;
    }
    setUploading((u) => u + urls.length);
    for (const url of urls) {
      try { const r = await api("/api/products/images", { method: "POST", body: JSON.stringify({ url }) }); addImages(r.urls); }
      catch (e: any) { notify("err", e.message); }
      finally { setUploading((u) => u - 1); }
    }
    setLink("");
  }
  const moveImage = (i: number, to: number) => setF((p) => { const a = [...p.images]; const [x] = a.splice(i, 1); a.splice(to, 0, x); return { ...p, images: a }; });

  // Renk × beden seçiminden varyant satırları (mevcut satırların stok/barkodu korunur)
  function buildVariants() {
    const cs = colors.length ? colors : [""];
    const ss = sizes.length ? sizes : [""];
    const combos = cs.flatMap((c) => ss.map((z) => [c && `Renk: ${c}`, z && `Beden: ${z}`].filter(Boolean).join(", "))).filter(Boolean);
    if (!combos.length) return notify("err", "En az bir renk veya beden seç.");
    setF((p) => ({ ...p, variants: combos.map((attrs) => p.variants.find((v) => v.attrs === attrs) ?? { ...emptyVariant(), attrs, stock: p.variants[0]?.stock ?? "" }) }));
  }
  const toggle = (list: string[], v: string, setter: (x: string[]) => void) => setter(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (on: boolean) => ({ padding: "4px 10px", borderRadius: 14, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent)" : "var(--panel)", color: on ? "var(--accent-ink)" : "var(--ink)", cursor: "pointer", font: "inherit", fontSize: 13 });

  const input = (k: keyof Form, label: string, hint?: string, mode: "text" | "decimal" | "numeric" = "text", list?: string, ph?: string) => (
    <label className="f">{label}
      <input type="text" inputMode={mode} list={list} placeholder={ph} value={f[k] as string} onChange={(e) => set(k, e.target.value)} />
      {err(k) ?? (hint && <small>{hint}</small>)}
    </label>
  );
  const single = f.variants.length === 1 && !hasVariants;

  return (
    <>
    <div className="row" style={{ marginBottom: 12 }}>
      <button className="btn" onClick={onClose}>← Ürünler</button>
      <h2 style={{ margin: 0 }}>{isNew ? "Yeni ürün" : f.title}</h2>
      {!isNew && <span className="muted">SKU {f.sku}</span>}
    </div>
    <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>

      <datalist id="cats">{opts.categories.map((c) => <option key={c.name} value={c.name}>{c.markets.length ? `✓ ${c.markets.join(", ")}` : ""}</option>)}</datalist>
      <datalist id="desi">{DESI.map((d) => <option key={d} value={d} />)}</datalist>

      <div className="card">
        <h2>Temel bilgiler</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>SKU ve barkod kaydederken otomatik oluşur. Sadece aşağıdakileri doldur.</p>
        <label className="f">Ürün adı
          <input type="text" autoFocus={isNew} value={f.title} placeholder="Örn. Bambu Kesme Tahtası 3'lü Set" onChange={(e) => set("title", e.target.value)} />
          {err("title") ?? <small>{f.title.length} karakter · Trendyol en fazla 100, N11 en fazla 65</small>}
        </label>
        <div className="grid" style={{ marginTop: 12 }}>
          <label className="f">Marka
            <BrandInput api={api} value={f.brand} onChange={(v) => set("brand", v)} local={opts.brands} placeholder={opts.defaultBrand} />
            {err("brand") ?? <small>Yazdıkça pazaryerlerindeki markalar listelenir</small>}
          </label>
          <label className="f">Kategori
            <input type="text" list="cats" value={f.category} placeholder="Yazmaya başla, listeden seç" onChange={(e) => set("category", e.target.value)} />
            {err("category") ?? <small>{!f.category ? "Kategoriler sekmesindeki eşleşmelerden seç" : cat?.markets.length
              ? <span style={{ color: "var(--ok)" }}>✓ {cat.markets.map((m) => `${m}${cat.names[m] ? ` (${cat.names[m]})` : ""}`).join(", ")}</span>
              : "Bu kategori henüz hiçbir pazaryerine eşleşmemiş"}</small>}
          </label>
          {input("cost_price", "Alış fiyatı (KDV dahil, TL)", "Satış fiyatı her pazaryerinde formülle hesaplanır", "decimal", undefined, "0,00")}
          {single && <label className="f">Stok
            <input type="text" inputMode="numeric" value={f.variants[0].stock} placeholder="0" onChange={(e) => setV(0, "stock", e.target.value)} />
            {err("variants.0.stock")}
          </label>}
          {input("desi", "Desi", "Küçük paket 1, ayakkabı kutusu ~3", "decimal", "desi")}
          <label className="f">KDV
            <select value={f.vat_rate} onChange={(e) => set("vat_rate", e.target.value)}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select>{err("vat_rate")}
          </label>
        </div>
        <label className="f" style={{ marginTop: 12 }}>Açıklama
          <textarea value={f.description} placeholder="Ürünün özellikleri, ölçüleri, malzemesi, kutu içeriği..." onChange={(e) => set("description", e.target.value)} style={{ minHeight: 100, fontFamily: "inherit" }} />{err("description")}
        </label>
      </div>

      <div className="card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (canEdit) upload([...e.dataTransfer.files]); }}
        onPaste={(e) => { const fl = [...e.clipboardData.files]; if (fl.length && canEdit) { e.preventDefault(); upload(fl); } }}>
        <h2>Görseller {f.images.length > 0 && <span className="muted">({f.images.length})</span>}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Bilgisayardan seç, buraya sürükle veya panodan yapıştır (Ctrl+V). İlk görsel ana görseldir. Kare veya dikey, en az 1200 px önerilir.
        </p>
        <div className="row">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Bilgisayardan seç</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          {uploading > 0 && <span className="muted">Yükleniyor ({uploading})...</span>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="text" value={link} placeholder="veya görsel linki yapıştır (https://...jpg)" onChange={(e) => setLink(e.target.value)} style={{ flex: "1 1 260px" }}
            onKeyDown={(e) => { if (e.key === "Enter") addLink(true); }} />
          <button className="btn" onClick={() => addLink(true)} disabled={!link.trim()} title="Görseli indirip kendi depomuza kaydeder; kaynak site silse de kaybolmaz">Linkten ekle</button>
        </div>
        <small className="muted">Linkten eklenen görsel kendi depona kopyalanır, kaynak site silse de kaybolmaz.</small>
        {Object.entries(errs).filter(([k]) => k.startsWith("images")).map(([k, m]) => <div key={k}><small style={{ color: "var(--bad)" }}>{k === "images" ? m : `${Number(k.split(".")[1]) + 1}. görsel: ${m}`}</small></div>)}
        {f.images.length > 0 && <div className="row" style={{ marginTop: 12, alignItems: "flex-start" }}>
          {f.images.map((u, i) => (
            <div key={u} style={{ position: "relative", width: 96 }}>
              <img src={u} alt="" width={96} height={96} style={{ objectFit: "cover", borderRadius: 4, border: `2px solid ${i === 0 ? "var(--accent)" : "var(--line)"}`, display: "block" }} />
              {i === 0 && <small style={{ position: "absolute", top: 4, left: 4, background: "var(--accent)", color: "var(--accent-ink)", padding: "0 5px", borderRadius: 3, fontSize: 11 }}>Ana</small>}
              {canEdit && <div className="row" style={{ gap: 2, marginTop: 4, justifyContent: "space-between" }}>
                <button className="btn" style={{ padding: "2px 7px" }} disabled={i === 0} onClick={() => moveImage(i, i - 1)} title="Sola al">‹</button>
                {i > 0 && <button className="btn" style={{ padding: "2px 7px" }} onClick={() => moveImage(i, 0)} title="Ana görsel yap">★</button>}
                <button className="btn danger" style={{ padding: "2px 7px" }} onClick={() => setF((p) => ({ ...p, images: p.images.filter((x) => x !== u) }))} title="Kaldır">×</button>
              </div>}
            </div>
          ))}
        </div>}
      </div>

      <div className="card">
        <h2>Renk / beden seçenekleri</h2>
        <label className="check"><input type="checkbox" checked={hasVariants} onChange={(e) => {
          setHasVariants(e.target.checked);
          if (!e.target.checked) setF((p) => ({ ...p, variants: [p.variants[0]] }));
        }} />Bu ürünün farklı renk veya bedenleri var</label>
        {hasVariants && <>
          <div style={{ marginTop: 12 }}><small className="muted">Renk</small>
            <div className="row" style={{ marginTop: 4 }}>{COLORS.map((c) => <button key={c} style={chip(colors.includes(c))} onClick={() => toggle(colors, c, setColors)}>{c}</button>)}</div>
          </div>
          <div style={{ marginTop: 10 }}><small className="muted">Beden</small>
            <div className="row" style={{ marginTop: 4 }}>{SIZES.map((z) => <button key={z} style={chip(sizes.includes(z))} onClick={() => toggle(sizes, z, setSizes)}>{z}</button>)}</div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={buildVariants}>Seçeneklerden satırları oluştur</button>
            <button className="btn" onClick={() => setF((p) => ({ ...p, variants: [...p.variants, emptyVariant()] }))}>Boş satır ekle</button>
          </div>
          {err("variants")}
          <div className="scroll" style={{ marginTop: 10 }}><table>
            <thead><tr><th>Seçenek</th><th className="n">Stok</th><th className="n">Alış fiyatı</th><th>Barkod</th><th /></tr></thead>
            <tbody>{f.variants.map((v, i) => (
              <tr key={v.id ?? `n${i}`}>
                <td><input type="text" value={v.attrs} placeholder="Renk: Siyah, Beden: M" onChange={(e) => setV(i, "attrs", e.target.value)} /></td>
                <td className="n" style={{ width: 90 }}><input type="text" inputMode="numeric" value={v.stock} placeholder="0" onChange={(e) => setV(i, "stock", e.target.value)} />{err(`variants.${i}.stock`)}{v.reserved ? <small className="muted">rezerve {v.reserved}</small> : null}</td>
                <td className="n" style={{ width: 110 }}><input type="text" inputMode="decimal" value={v.cost_price} placeholder="ana fiyat" onChange={(e) => setV(i, "cost_price", e.target.value)} />{err(`variants.${i}.cost_price`)}</td>
                <td style={{ width: 160 }}><input type="text" value={v.barcode} placeholder="otomatik" onChange={(e) => setV(i, "barcode", e.target.value)} />{err(`variants.${i}.barcode`)}{err(`variants.${i}.sku`)}</td>
                <td>{f.variants.length > 1 && <button className="btn danger" onClick={() => setF((p) => ({ ...p, variants: p.variants.filter((_, j) => j !== i) }))}>Sil</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>}
      </div>

      {listings && listings.length > 0 && <div className="card">
        <h2>Pazaryerlerinde</h2>
        <div className="scroll"><table className="cards">
          <thead><tr><th>Pazaryeri</th><th>İlan (barkod)</th><th>Durum</th><th className="n">Fiyat</th><th className="n">Stok</th><th>Son görülme</th></tr></thead>
          <tbody>{listings.map((l) => (
            <tr key={l.marketplace + l.listing_key}>
              <td data-label="Pazaryeri">{l.marketplace === "trendyol" ? "Trendyol" : l.marketplace === "hepsiburada" ? "Hepsiburada" : l.marketplace}</td>
              <td data-label="İlan" style={{ fontSize: 13 }}>{l.listing_key}{l.category_name ? <><br /><span className="muted" style={{ fontSize: 12 }}>{l.category_name}</span></> : null}</td>
              <td data-label="Durum"><span className={`pill ${LISTING_PILL[l.status] ?? ""}`}>{LISTING_TR[l.status] ?? l.status}</span>{l.last_error ? <><br /><span style={{ color: "var(--bad)", fontSize: 12 }}>{String(l.last_error).slice(0, 200)}</span></> : null}</td>
              <td data-label="Fiyat" className="n">{l.price != null ? tl(Number(l.price)) : "-"}</td>
              <td data-label="Stok" className="n">{l.stock ?? "-"}</td>
              <td data-label="Son görülme" className="muted" style={{ fontSize: 13 }}>{when(l.seen_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Durum pazaryerinden okunur (her senkronda); "yayında" yalnızca pazaryeri onaylı ve açık ilan demektir.</p>
      </div>}

      {!isNew && <AmazonMatches key={matchKey} api={api} notify={notify} productId={f.id!} variants={f.variants} canEdit={canEdit} />}

      {role === "admin" && <PricePreview api={api} cost={n(f.cost_price) ?? n(f.variants[0]?.cost_price ?? "")} currency={f.currency} vat={Number(f.vat_rate) || 20} category={f.category} brand={f.brand} source={f.source ?? "manual"} stock={f.variants.reduce((t, v) => t + (Number(v.stock) || 0), 0)} />}

      <div className="card">
        <h2>Pazaryerine hazır mı?</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Gönderim düğmeleri pazaryeri bağlantıları kurulunca (Faz 4-5) burada açılacak. Eksikleri şimdiden tamamlarsan ürün sorunsuz gider.</p>
        <div className="grid">{ready.map((m) => {
          const miss = m.checks.filter((c) => !c.ok);
          return (
            <details key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px" }}>
              <summary style={{ color: "var(--ink)", fontSize: 14 }}>
                <b>{m.label}</b> <span className={`pill ${m.ready ? "ok" : "partial"}`}>{m.ready ? (miss.length ? "hazır (uyarı var)" : "hazır") : `${miss.filter((c) => !c.warn).length} eksik`}</span>
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {m.checks.map((c) => <li key={c.text} style={{ color: c.ok ? "var(--ok)" : c.warn ? "var(--warn)" : "var(--bad)" }}>{c.ok ? "✓" : c.warn ? "!" : "✗"} {c.text}</li>)}
              </ul>
            </details>
          );
        })}</div>
      </div>

      <details className="card">
        <summary>Gelişmiş: SKU, barkod, durum, para birimi, ek özellikler</summary>
        <div className="grid" style={{ marginTop: 12 }}>
          {input("sku", "Model kodu (SKU)", "Boş bırakırsan otomatik oluşur", "text", undefined, "otomatik")}
          {single && <label className="f">Barkod
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input type="text" value={f.variants[0].barcode} placeholder="otomatik" onChange={(e) => setV(0, "barcode", e.target.value)} />
              <button className="btn" onClick={() => setV(0, "barcode", generateEan13())} title="Yeni barkod üret">↻</button>
            </div>
            {err("variants.0.barcode") ?? <small>Ürünün gerçek EAN barkodu varsa yaz (Amazon için gerekli). Yoksa otomatik.</small>}
          </label>}
          <label className="f">Durum
            <select value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Aktif</option><option value="draft">Taslak</option><option value="archived">Arşiv</option>
            </select>{err("status") ?? <small>Taslak ürün pazaryerine gönderilmez</small>}
          </label>
          <label className="f">Para birimi
            <select value={f.currency} onChange={(e) => set("currency", e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></select>
          </label>
        </div>
        <label className="f" style={{ marginTop: 12 }}>Ek özellikler (her satıra "Ad: Değer")
          <textarea value={f.attrs} placeholder={"Malzeme: Bambu\nMenşei: Türkiye\nGaranti: 2 yıl"} onChange={(e) => set("attrs", e.target.value)} />
        </label>
      </details>

      <div className="row" style={{ marginBottom: 16, position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
        {canEdit && <>
          <button className="btn primary" disabled={busy || uploading > 0} onClick={() => save(isNew ? "close" : undefined)}>{busy ? "Kaydediliyor..." : isNew ? "Kaydet" : "Değişiklikleri kaydet"}</button>
          {isNew && <button className="btn" disabled={busy || uploading > 0} onClick={() => save("new")}>Kaydet ve yeni ekle</button>}
          {!isNew && f.status === "active" && <button className="btn" onClick={async () => { if (await sendToMarketplace(api, notify, [f.id!], role === "admin")) api(`/api/products/${f.id}?listings=1`).then(setListings).catch(() => {}); }}><Icon name="store" size={16} />Trendyol'a gönder</button>}
          {!isNew && f.status === "active" && <button className="btn" onClick={async () => { if (await sendToMarketplace(api, notify, [f.id!], role === "admin", "amazon")) { api(`/api/products/${f.id}?listings=1`).then(setListings).catch(() => {}); setMatchKey((k) => k + 1); } }}><Icon name="store" size={16} />Amazon'a gönder</button>}
          {!isNew && <button className="btn" onClick={() => onCopy(f)}>Kopyasını oluştur</button>}
          {!isNew && f.status !== "archived" && <button className="btn" onClick={archive}>Arşivle</button>}
          {role === "admin" && !isNew && <button className="btn danger" onClick={hardDelete}>Kalıcı sil</button>}
        </>}
        {!canEdit && <span className="muted">Salt okunur (rol: görüntüleyici)</span>}
      </div>

      {audit && audit.length > 0 && <div className="card">
        <h2>Değişiklik geçmişi</h2>
        <table><tbody>{audit.map((x) => <tr key={x.id}><td className="muted" style={{ width: 180 }}>{when(x.at)}</td><td>{x.actor}</td><td>{ACTION_TR[x.action] ?? x.action}</td></tr>)}</tbody></table>
      </div>}
    </fieldset>
    </>
  );
}

// Amazon: var olan Amazon ürünü (ASIN) eşleşmesi. Gönderim EAN ile tek sonuç bulursa otomatik onaylar; başlıkla bulunan adaylar burada onaylanır.
function AmazonMatches({ api, notify, productId, variants, canEdit }: { api: Api; notify: Notify; productId: string; variants: VariantForm[]; canEdit: boolean }) {
  const [list, setList] = useState<Row[] | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const load = useCallback(() => api(`/api/matches?product=${productId}`).then(setList).catch(() => setList([])), [api, productId]);
  useEffect(() => { load(); }, [load]);
  async function decide(body: Record<string, unknown>, ok: string) {
    try { await api("/api/matches", { method: "PUT", body: JSON.stringify(body) }); notify("good", ok); load(); } catch (e: any) { notify("err", e.message); }
  }
  const amz = (list ?? []).filter((m) => m.marketplace === "amazon");
  if (!list || (!amz.length && !canEdit)) return null;
  return (
    <div className="card">
      <h2>Amazon eşleşmesi</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Amazon'da yeni ürün açmak için gerçek barkod (GTIN) veya muafiyet gerekir. O zamana kadar ürünün Amazon'da zaten satılan aynısına (ASIN) teklif verilir.
        "Amazon'a gönder" adayları bulur; doğru olanı onayla, sonra tekrar gönder. Doğru ürünü biliyorsan ASIN'i elle yazabilirsin.
      </p>
      {variants.filter((v) => v.id).map((v) => {
        const mine = amz.filter((m) => m.variant_id === v.id);
        const ok = mine.find((m) => m.status === "confirmed");
        return (
          <div key={v.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{v.sku}{v.attrs ? ` · ${v.attrs}` : ""}{v.barcode ? ` · barkod ${v.barcode}` : ""}</div>
            {ok ? <div className="row"><span className="pill ok">eşleşti</span><b>{ok.external_id}</b><span>{ok.title}</span><span className="muted" style={{ fontSize: 12 }}>({ok.matched_by === "ean" ? "barkodla" : ok.matched_by === "manual" ? "elle" : "başlıkla"}, {ok.decided_by})</span>
              {canEdit && <button className="btn ghost" onClick={() => decide({ id: ok.id, status: "rejected" }, "Eşleşme kaldırıldı.")}>Kaldır</button>}</div>
              : mine.filter((m) => m.status === "suggested").length ? (
                <div className="grid">{mine.filter((m) => m.status === "suggested").map((m) => (
                  <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "flex", gap: 10 }}>
                    {m.image ? <img src={m.image} alt="" width={56} height={56} style={{ objectFit: "contain", borderRadius: 6, background: "#fff" }} /> : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{m.title || m.external_id}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{m.external_id}{m.brand ? ` · ${m.brand}` : ""}</div>
                      {canEdit && <div className="row" style={{ marginTop: 6 }}>
                        <button className="btn primary" style={{ minHeight: 30, padding: "2px 10px" }} onClick={() => decide({ id: m.id, status: "confirmed" }, "Eşleşme onaylandı. Şimdi Amazon'a gönderebilirsin.")}>Bu ürün</button>
                        <button className="btn" style={{ minHeight: 30, padding: "2px 10px" }} onClick={() => decide({ id: m.id, status: "rejected" }, "Aday reddedildi.")}>Değil</button>
                      </div>}
                    </div>
                  </div>
                ))}</div>
              ) : <span className="muted" style={{ fontSize: 13 }}>Henüz aday yok. "Amazon'a gönder" ile aranır.</span>}
            {canEdit && !ok && <div className="row" style={{ marginTop: 8 }}>
              <input type="text" placeholder="ASIN'i biliyorsan yaz (B0...)" value={manual[v.id!] ?? ""} onChange={(e) => setManual({ ...manual, [v.id!]: e.target.value })} style={{ maxWidth: 240 }} />
              <button className="btn" disabled={!(manual[v.id!] ?? "").trim()} onClick={() => decide({ variant_id: v.id, product_id: productId, marketplace: "amazon", external_id: manual[v.id!], status: "confirmed" }, "ASIN kaydedildi.")}>Kaydet</button>
            </div>}
          </div>
        );
      })}
    </div>
  );
}
