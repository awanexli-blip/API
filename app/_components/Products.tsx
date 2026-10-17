"use client";

import { useCallback, useEffect, useState } from "react";
import { issuesByPath, productSchema } from "@/lib/validation/product";
import { tl, when, type Api, type Notify, type Row } from "./shared";

type Role = "viewer" | "editor" | "admin";
const STATUS_TR: Record<string, string> = { draft: "Taslak", active: "Aktif", archived: "Arşiv" };
const ACTION_TR: Record<string, string> = { create: "oluşturuldu", update: "güncellendi", archive: "arşivlendi", delete: "silindi" };

// "Renk: Kırmızı, Beden: M" <-> { Renk: "Kırmızı", Beden: "M" }
const toText = (o: Record<string, string> | undefined, sep = ", ") => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join(sep);
const toMap = (s: string) => Object.fromEntries(s.split(/[,\n]/).map((x) => x.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(":").trim()]));

type VariantForm = { id?: string; sku: string; barcode: string; attrs: string; stock: string; cost_price: string; reserved?: number };
type Form = {
  id?: string; sku: string; title: string; description: string; brand: string; category: string;
  vat_rate: string; desi: string; cost_price: string; currency: string; status: string; attrs: string; images: string; variants: VariantForm[];
};
const emptyVariant = (): VariantForm => ({ sku: "", barcode: "", attrs: "", stock: "0", cost_price: "" });
const emptyForm = (): Form => ({ sku: "", title: "", description: "", brand: "", category: "", vat_rate: "20", desi: "", cost_price: "", currency: "TRY", status: "draft", attrs: "", images: "", variants: [emptyVariant()] });
const s = (v: unknown) => (v == null ? "" : String(v));

function fromProduct(p: Row): Form {
  return {
    id: p.id, sku: p.sku, title: p.title, description: p.description ?? "", brand: p.brand ?? "", category: p.category ?? "",
    vat_rate: s(p.vat_rate), desi: s(p.desi), cost_price: s(p.cost_price), currency: p.currency ?? "TRY", status: p.status,
    attrs: toText(p.attributes, "\n"), images: (p.images ?? []).join("\n"),
    variants: (p.variants ?? []).map((v: Row) => ({ id: v.id, sku: v.sku, barcode: v.barcode ?? "", attrs: toText(v.attributes), stock: s(v.stock), cost_price: s(v.cost_price), reserved: v.reserved })),
  };
}
function toPayload(f: Form) {
  return {
    sku: f.sku, title: f.title, description: f.description, brand: f.brand, category: f.category,
    vat_rate: f.vat_rate, desi: f.desi, cost_price: f.cost_price, currency: f.currency, status: f.status,
    attributes: toMap(f.attrs), images: f.images.split(/\s+/).filter(Boolean),
    variants: f.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, attributes: toMap(v.attrs), stock: v.stock, cost_price: v.cost_price })),
  };
}

export default function Products({ api, notify }: { api: Api; notify: Notify }) {
  const [role, setRole] = useState<Role>("viewer");
  const [editing, setEditing] = useState<Form | null>(null);
  useEffect(() => { api("/api/me").then((m) => setRole(m.role)).catch(() => {}); }, [api]);
  const canEdit = role !== "viewer";

  const open = async (id?: string) => {
    if (!id) return setEditing(emptyForm());
    try { setEditing(fromProduct(await api(`/api/products/${id}`))); } catch (e: any) { notify("err", e.message); }
  };

  return editing
    ? <Editor api={api} notify={notify} role={role} initial={editing} onClose={() => setEditing(null)} />
    : <List api={api} notify={notify} canEdit={canEdit} onOpen={open} />;
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
        {canEdit && <button className="btn primary" onClick={() => onOpen()}>Yeni ürün</button>}
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

function Editor({ api, notify, role, initial, onClose }: { api: Api; notify: Notify; role: Role; initial: Form; onClose: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<Row[] | null>(null);
  const canEdit = role !== "viewer";
  const isNew = !f.id;
  const set = (k: keyof Form, v: string) => setF({ ...f, [k]: v });
  const setV = (i: number, k: keyof VariantForm, v: string) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const err = (k: string) => (errs[k] ? <small style={{ color: "var(--bad)" }}>{errs[k]}</small> : null);

  useEffect(() => { if (f.id) api(`/api/products/${f.id}?audit=1`).then(setAudit).catch(() => setAudit([])); }, [api, f.id]);

  async function save() {
    const payload = toPayload(f);
    const r = productSchema.safeParse(payload);
    if (!r.success) { setErrs(issuesByPath(r.error)); notify("err", "Formda hata var, kırmızı alanları düzelt."); return; }
    setErrs({}); setBusy(true);
    try {
      const saved = await api(isNew ? "/api/products" : `/api/products/${f.id}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) });
      setF(fromProduct(saved));
      notify("good", isNew ? "Ürün oluşturuldu." : "Ürün kaydedildi.");
      api(`/api/products/${saved.id}?audit=1`).then(setAudit).catch(() => {});
    } catch (e: any) { notify("err", e.message); }
    setBusy(false);
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

  const input = (k: keyof Form, label: string, hint?: string, mode: "text" | "decimal" = "text") => (
    <label className="f">{label}
      <input type="text" inputMode={mode} value={f[k] as string} disabled={!canEdit} onChange={(e) => set(k, e.target.value)} />
      {err(k) ?? (hint && <small>{hint}</small>)}
    </label>
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={onClose}>← Ürünler</button>
        <h2 style={{ margin: 0 }}>{isNew ? "Yeni ürün" : f.title}</h2>
      </div>

      <div className="card">
        <h2>Genel</h2>
        <div className="grid">
          {input("sku", "Model kodu (SKU)", "Harf, rakam, . _ - · boşluk yok")}
          {input("title", "Başlık")}
          {input("brand", "Marka")}
          {input("category", "Kategori (iç)", "Örn. Ev & Yaşam > Banyo")}
          <label className="f">Durum
            <select value={f.status} disabled={!canEdit} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Taslak</option><option value="active">Aktif</option><option value="archived">Arşiv</option>
            </select>{err("status")}
          </label>
        </div>
        <label className="f" style={{ marginTop: 12 }}>Açıklama
          <textarea value={f.description} disabled={!canEdit} onChange={(e) => set("description", e.target.value)} style={{ minHeight: 100, fontFamily: "inherit" }} />{err("description")}
        </label>
      </div>

      <div className="card">
        <h2>Fiyat ve vergi</h2>
        <div className="grid">
          {input("cost_price", "Maliyet (KDV dahil)", "Varyantta ayrıca girilmezse bu kullanılır", "decimal")}
          <label className="f">Para birimi
            <select value={f.currency} disabled={!canEdit} onChange={(e) => set("currency", e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></select>
          </label>
          <label className="f">KDV
            <select value={f.vat_rate} disabled={!canEdit} onChange={(e) => set("vat_rate", e.target.value)}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select>{err("vat_rate")}
          </label>
          {input("desi", "Desi", undefined, "decimal")}
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Satış fiyatı pazaryerine göre ayrı hesaplanır (pazaryeri sekmelerindeki fiyat ayarları).</p>
      </div>

      <div className="card">
        <h2>Varyantlar</h2>
        {err("variants")}
        <div className="scroll"><table>
          <thead><tr><th>SKU</th><th>Barkod</th><th>Özellikler</th><th className="n">Stok</th><th className="n">Maliyet</th><th /></tr></thead>
          <tbody>{f.variants.map((v, i) => (
            <tr key={v.id ?? `n${i}`}>
              <td><input type="text" value={v.sku} disabled={!canEdit} onChange={(e) => setV(i, "sku", e.target.value)} />{err(`variants.${i}.sku`)}</td>
              <td><input type="text" value={v.barcode} disabled={!canEdit} placeholder="EAN veya iç kod" onChange={(e) => setV(i, "barcode", e.target.value)} />{err(`variants.${i}.barcode`)}</td>
              <td><input type="text" value={v.attrs} disabled={!canEdit} placeholder="Renk: Siyah, Beden: M" onChange={(e) => setV(i, "attrs", e.target.value)} /></td>
              <td className="n" style={{ width: 90 }}><input type="text" inputMode="numeric" value={v.stock} disabled={!canEdit} onChange={(e) => setV(i, "stock", e.target.value)} />{err(`variants.${i}.stock`)}{v.reserved ? <small className="muted">rezerve {v.reserved}</small> : null}</td>
              <td className="n" style={{ width: 110 }}><input type="text" inputMode="decimal" value={v.cost_price} disabled={!canEdit} onChange={(e) => setV(i, "cost_price", e.target.value)} />{err(`variants.${i}.cost_price`)}</td>
              <td>{canEdit && f.variants.length > 1 && <button className="btn danger" onClick={() => setF({ ...f, variants: f.variants.filter((_, j) => j !== i) })}>Sil</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {canEdit && <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setF({ ...f, variants: [...f.variants, emptyVariant()] })}>Varyant ekle</button>
          {f.variants.length === 1 && !f.variants[0].sku && f.sku && <button className="btn" onClick={() => setV(0, "sku", f.sku)}>SKU'yu model kodundan al</button>}
        </div>}
      </div>

      <div className="card">
        <h2>Görseller ve özellikler</h2>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label className="f">Görsel adresleri (her satıra bir https adresi, en fazla 20)
            <textarea value={f.images} disabled={!canEdit} onChange={(e) => set("images", e.target.value)} style={{ minHeight: 110 }} />
            {Object.entries(errs).filter(([k]) => k.startsWith("images")).map(([k, m]) => <small key={k} style={{ color: "var(--bad)" }}>{k === "images" ? m : `${Number(k.split(".")[1]) + 1}. görsel: ${m}`}</small>)}
          </label>
          <label className="f">Ürün özellikleri (her satıra "Ad: Değer")
            <textarea value={f.attrs} disabled={!canEdit} placeholder={"Malzeme: Bambu\nMenşei: TR"} onChange={(e) => set("attrs", e.target.value)} style={{ minHeight: 110 }} />
          </label>
        </div>
        {f.images.trim() && <div className="row" style={{ marginTop: 8 }}>
          {f.images.split(/\s+/).filter((u) => u.startsWith("https://")).slice(0, 20).map((u, i) => <img key={i} src={u} alt="" width={64} height={64} style={{ objectFit: "cover", borderRadius: 4, border: "1px solid var(--line)" }} />)}
        </div>}
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        {canEdit && <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Kaydediliyor..." : isNew ? "Ürünü oluştur" : "Kaydet"}</button>}
        {canEdit && !isNew && f.status !== "archived" && <button className="btn" onClick={archive}>Arşivle</button>}
        {role === "admin" && !isNew && <button className="btn danger" onClick={hardDelete}>Kalıcı sil</button>}
        {!canEdit && <span className="muted">Salt okunur (rol: görüntüleyici)</span>}
      </div>

      {audit && audit.length > 0 && <div className="card">
        <h2>Değişiklik geçmişi</h2>
        <table><tbody>{audit.map((x) => <tr key={x.id}><td className="muted" style={{ width: 180 }}>{when(x.at)}</td><td>{x.actor}</td><td>{ACTION_TR[x.action] ?? x.action}</td></tr>)}</tbody></table>
      </div>}
    </>
  );
}
