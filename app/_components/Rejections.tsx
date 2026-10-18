"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { when, type Props, type Row } from "./shared";

const STATUS: Record<string, [string, string]> = {
  auto: ["sistem düzeltecek", "info"], needs_user: ["senin düzeltmen gerek", "partial"], user_ready: ["sonraki senkronda gönderilecek", "info"],
  resubmitted: ["yeniden gönderildi", "ok"], gave_up: ["vazgeçildi", ""],
};

// Trendyol'un reddettiği ürünler: sistem yasaklı kelime / marka ekini kendisi düzeltir; kategori, görsel ve tekrar eden retler burada düzeltilir
export default function Rejections({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  const [word, setWord] = useState("");
  const [filter, setFilter] = useState<"user" | "all">("user");
  const [uploading, setUploading] = useState(false);
  const load = useCallback(() => api(`/api/rejections?mp=${marketplace}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, marketplace]);
  useEffect(() => { load(); }, [load]);

  const edit = (it: Row) => {
    if (open === it.listing_key) return setOpen(null);
    const p = it.fix?.proposed ?? {};
    setForm({ title: p.title ?? it.title ?? "", description: p.description ?? "", category_id: p.category_id ?? "", category_name: p.category_name ?? "", images: p.images ?? [] });
    setOpen(it.listing_key);
  };
  async function save(key: string, action: "resubmit" | "giveup" | "auto") {
    try {
      const body = action === "resubmit" ? { listing_key: key, action, ...form } : { listing_key: key, action };
      await api(`/api/rejections?mp=${marketplace}`, { method: "PUT", body: JSON.stringify(body) });
      notify("good", action === "resubmit" ? "Düzeltme kaydedildi; bir sonraki senkronda Trendyol'a yeniden onaya gönderilecek." : action === "giveup" ? "Bu ürün için vazgeçildi." : "Sisteme bırakıldı.");
      setOpen(null); load();
    } catch (e: any) { notify("err", e.message); }
  }
  async function upload(files: File[]) {
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of files.filter((x) => x.type.startsWith("image/"))) { const fd = new FormData(); fd.append("file", f); const r = await api("/api/products/images", { method: "POST", body: fd }); urls.push(...r.urls); }
      setForm((x) => ({ ...x, images: [...(x.images ?? []), ...urls].slice(0, 8) }));
    } catch (e: any) { notify("err", e.message); } finally { setUploading(false); }
  }
  async function addWord() {
    try { await api(`/api/rejections?mp=${marketplace}`, { method: "POST", body: JSON.stringify({ word }) }); setWord(""); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function delWord(w: string) {
    try { await api(`/api/rejections?mp=${marketplace}&word=${encodeURIComponent(w)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const items = d.items.filter((i: Row) => filter === "all" || !i.fix || i.fix.status === "needs_user");
  const needs = d.items.filter((i: Row) => i.fix?.status === "needs_user").length;

  return (
    <>
      <div className="card">
        <h2>Reddedilen ürünler</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Sistemin açtığı ürünleri Trendyol reddederse: <b>yasaklı kelime</b> ve başlıktaki <b>yabancı marka eki</b> (" -Birlik" gibi) her senkronda otomatik silinip ürün yeniden onaya gönderilir (en fazla 2 kez).
          <b> Kategori yanlış</b>, <b>görselde marka</b> veya tekrar eden retler senin düzeltmeni bekler. Öğrenilen yasaklı kelimeler yeni ürünlerde baştan temizlenir.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Reddedilen</div><div className="value">{d.items.length}</div></div>
          <div className="kpi"><div className="label">Senin düzeltmen gereken</div><div className="value" style={{ color: needs ? "var(--warn)" : undefined }}>{needs}</div></div>
          <div className="kpi"><div className="label">Yeniden onayda</div><div className="value">{d.inReview}</div><div className="hint">düzeltilip gönderildi</div></div>
          <div className="kpi"><div className="label">Yasaklı kelime</div><div className="value">{d.banned.length}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="seg">
            <button aria-pressed={filter === "user"} onClick={() => setFilter("user")}>Düzeltmem gerekenler</button>
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Tümü</button>
          </div>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
        </div>
        {items.length === 0 ? <div className="empty"><Icon name="check" size={28} /><p>{filter === "user" ? "Senin düzeltmeni bekleyen ürün yok." : "Reddedilen ürün yok."}</p></div> : items.map((it: Row) => {
          const st = STATUS[it.fix?.status ?? "auto"] ?? STATUS.auto;
          return (
            <div key={it.listing_key} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{it.title || it.listing_key}</b> <span className={`pill ${st[1]}`}>{st[0]}</span>
                  <div className="muted" style={{ fontSize: 12 }}>{it.listing_key}{it.fix?.attempts ? ` · ${it.fix.attempts} otomatik deneme` : ""} · {when(it.updated_at)}</div>
                  <div style={{ fontSize: 13, color: "var(--bad)", marginTop: 4 }}>{String(it.last_error ?? "").slice(0, 400)}</div>
                  {it.fix?.note && <div style={{ fontSize: 13, marginTop: 4 }}><Icon name="info" size={14} /> {it.fix.note}</div>}
                </div>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <button className="btn primary" onClick={() => edit(it)}>{open === it.listing_key ? "Kapat" : "Düzelt"}</button>
                  <button className="btn ghost" onClick={() => save(it.listing_key, "giveup")}>Vazgeç</button>
                </div>
              </div>
              {open === it.listing_key && (
                <div className="card" style={{ marginTop: 10, marginBottom: 0, background: "var(--panel-2)" }}>
                  <label className="f">Başlık (en fazla 100)<input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><small>{String(form.title ?? "").length} karakter · başka marka adı ve yasaklı kelime geçmesin</small></label>
                  <label className="f" style={{ marginTop: 10 }}>Açıklama (boş = değiştirme)<textarea value={form.description} style={{ minHeight: 90, fontFamily: "inherit" }} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
                  <label className="f" style={{ marginTop: 10 }}>Kategori (boş = değiştirme)
                    <select value={form.category_id} onChange={(e) => { const c = d.categories.find((x: Row) => String(x.category_id) === e.target.value); setForm({ ...form, category_id: e.target.value, category_name: c?.category_name ?? "" }); }}>
                      <option value="">— değiştirme —</option>
                      {d.categories.map((c: Row) => <option key={c.category_id} value={c.category_id}>{c.category_name || c.category_id} ({c.n} ürün)</option>)}
                    </select>
                    <small>Mağazanda kullanılan kategoriler (çoktan aza)</small>
                  </label>
                  <div style={{ marginTop: 10 }}>
                    <span className="muted" style={{ fontSize: 13 }}>Görseller (boş = değiştirme; markalı görsel yerine yenisini yükle)</span>
                    <div className="row" style={{ marginTop: 6 }}>
                      {(form.images ?? []).map((u: string) => <div key={u} style={{ position: "relative" }}><img src={u} alt="" width={64} height={64} style={{ objectFit: "cover", borderRadius: 6 }} /><button className="btn danger" style={{ position: "absolute", top: -6, right: -6, minHeight: 22, padding: "0 6px" }} onClick={() => setForm({ ...form, images: form.images.filter((x: string) => x !== u) })}>×</button></div>)}
                      <label className="btn" style={{ cursor: "pointer" }}>{uploading ? "Yükleniyor..." : "Görsel yükle"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} /></label>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn primary" disabled={uploading} onClick={() => save(it.listing_key, "resubmit")}>Kaydet ve yeniden gönder</button>
                    <button className="btn" onClick={() => save(it.listing_key, "auto")}>Sisteme bırak</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Yasaklı kelimeler</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Trendyol'un ret nedenlerinden kendiliğinden öğrenilir; elle de ekleyebilirsin. Yeni ürünlerin başlık ve açıklamasından gönderilmeden önce silinir.</p>
        <div className="row">
          <input type="text" value={word} placeholder="ör. orijinal" onChange={(e) => setWord(e.target.value)} style={{ maxWidth: 240 }} onKeyDown={(e) => { if (e.key === "Enter" && word.trim()) addWord(); }} />
          <button className="btn" disabled={word.trim().length < 2} onClick={addWord}>Ekle</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {d.banned.length === 0 ? <span className="muted">Henüz yok.</span> : d.banned.map((b: Row) => (
            <span key={b.word} className="pill" style={{ gap: 6 }}>{b.word}<span className="muted" style={{ fontSize: 11 }}>{b.source === "ret" ? "ret" : "elle"}</span><button onClick={() => delWord(b.word)} style={{ border: 0, background: "none", cursor: "pointer", color: "var(--muted)" }} aria-label="Sil">×</button></span>
          ))}
        </div>
      </div>
    </>
  );
}
