"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateEan13, generateSku, issuesByPath, productSchema } from "@/lib/validation/product";
import { readiness } from "@/lib/marketplace-readiness";
import { tl, when, type Api, type Notify, type Row } from "./shared";
import BrandInput from "./BrandInput";
import Import from "./Import";
import Feeds from "./Feeds";

type Role = "viewer" | "editor" | "admin";
const STATUS_TR: Record<string, string> = { draft: "Taslak", active: "Aktif", archived: "Arşiv" };
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
  vat_rate: string; desi: string; cost_price: string; currency: string; status: string; attrs: string; images: string[]; variants: VariantForm[];
};
type Options = { brands: string[]; defaultBrand: string; categories: { name: string; markets: string[]; names: Record<string, string> }[] };
const emptyVariant = (): VariantForm => ({ sku: "", barcode: "", attrs: "", stock: "", cost_price: "" });
const emptyForm = (brand = ""): Form => ({ sku: "", title: "", description: "", brand, category: "", vat_rate: "20", desi: "1", cost_price: "", currency: "TRY", status: "active", attrs: "", images: [], variants: [emptyVariant()] });
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function fromProduct(p: Row): Form {
  return {
    id: p.id, sku: p.sku, title: p.title, description: p.description ?? "", brand: p.brand ?? "", category: p.category ?? "",
    vat_rate: s(p.vat_rate), desi: s(p.desi), cost_price: s(p.cost_price), currency: p.currency ?? "TRY", status: p.status,
    attrs: toText(p.attributes, "\n"), images: p.images ?? [],
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
  const [view, setView] = useState<"liste" | "ice" | "feed">("liste");
  const [listKey, setListKey] = useState(0);
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
  const views: ["liste" | "ice" | "feed", string, boolean][] = [["liste", "Ürün listesi", true], ["ice", "İçe aktar", canEdit], ["feed", "XML feed", role === "admin"]];
  return (
    <>
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {views.filter(([, , ok]) => ok).map(([k, label]) => <button key={k} className={`btn ${view === k ? "primary" : ""}`} onClick={() => setView(k)}>{label}</button>)}
      </div>
      {view === "liste" && <List key={listKey} api={api} notify={notify} canEdit={canEdit} onOpen={open} />}
      {view === "ice" && <Import api={api} notify={notify} isAdmin={role === "admin"} onDone={() => { setListKey((k) => k + 1); loadOpts(); }} />}
      {view === "feed" && <Feeds api={api} notify={notify} />}
    </>
  );
}

function List({ api, notify, canEdit, onOpen }: { api: Api; notify: Notify; canEdit: boolean; onOpen: (id?: string) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [res, setRes] = useState<{ rows: Row[]; total: number; size: number } | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: "25", ...(q ? { q } : {}), ...(status ? { status } : {}) });
    try { setRes(await api(`/api/products?${p}`)); } catch (e: any) { notify("err", e.message); }
  }, [api, notify, page, q, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const pages = res ? Math.max(1, Math.ceil(res.total / res.size)) : 1;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Ürünler {res ? <span className="muted">({res.total})</span> : null}</h2>
        {canEdit && <button className="btn primary" onClick={() => onOpen()}>+ Yeni ürün</button>}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="text" placeholder="Başlık veya SKU ara" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ maxWidth: 320 }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ maxWidth: 160 }}>
          <option value="">Tüm durumlar</option><option value="active">Aktif</option><option value="draft">Taslak</option><option value="archived">Arşiv</option>
        </select>
      </div>
      {!res ? <p className="muted">Yükleniyor...</p> : res.rows.length === 0 ? (
        <p className="muted">{q || status ? "Aramaya uyan ürün yok." : "Henüz ürün yok. \"Yeni ürün\" ile ekle (CSV/XML içe aktarma Faz 2'de)."}</p>
      ) : (
        <div className="scroll"><table>
          <thead><tr><th /><th>SKU</th><th>Başlık</th><th className="n">Varyant</th><th className="n">Stok</th><th className="n">Maliyet</th><th>Durum</th><th>Güncelleme</th></tr></thead>
          <tbody>{res.rows.map((p) => (
            <tr key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: "pointer" }}>
              <td>{p.image ? <img src={p.image} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 4 }} /> : null}</td>
              <td>{p.sku}</td>
              <td>{p.title}<br /><span className="muted" style={{ fontSize: 12 }}>{[p.brand, p.category].filter(Boolean).join(" · ")}</span></td>
              <td className="n">{p.variants}</td>
              <td className="n">{p.stock}</td>
              <td className="n">{p.cost_price == null ? "-" : tl(Number(p.cost_price))}</td>
              <td><span className={`pill ${p.status === "active" ? "ok" : p.status === "archived" ? "error" : "partial"}`}>{STATUS_TR[p.status]}</span></td>
              <td className="muted" style={{ fontSize: 13 }}>{when(p.updated_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {pages > 1 && <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Önceki</button>
        <span className="muted">{page + 1} / {pages}</span>
        <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Sonraki</button>
      </div>}
    </div>
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
