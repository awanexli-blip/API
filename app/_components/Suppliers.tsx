"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD_LABEL, type Field } from "@/lib/import";
import { tl, when, type Api, type Notify, type Row } from "./shared";

const FIELDS = Object.keys(FIELD_LABEL) as Field[];
const STATUS_TR: Record<string, string> = { ok: "tamam", partial: "kısmen", error: "hata", running: "sürüyor" };
const slugify = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
// Aynı tedarikçinin ek XML linki: boş SKU öneki / eşleme = ana linkinki
type FeedDraft = { id?: string; label: string; url: string; url_masked?: string; sku_prefix: string; mapping: Record<string, Field> | null; item_path: string; own: boolean; info?: Row | null };
type Draft = {
  feeds: FeedDraft[];
  id?: string; code: string; name: string; xml_url: string; url_masked?: string; url_from_env?: string | null; active: boolean; nightly: boolean;
  item_path: string; mapping: Record<string, Field>; sku_prefix: string; sku_ascii: boolean; price_includes_vat: boolean; default_vat: number; default_brand: string; currency: string; marketplace_brand: string; default_attributes: string; dedupe_code_suffix: boolean;
};
const empty = (): Draft => ({ feeds: [], code: "", name: "", xml_url: "", active: true, nightly: true, item_path: "", mapping: {}, sku_prefix: "", sku_ascii: true, price_includes_vat: true, default_vat: 20, default_brand: "", currency: "TRY", marketplace_brand: "", default_attributes: "", dedupe_code_suffix: false });

export default function Suppliers({ api, notify }: { api: Api; notify: Notify }) {
  const [list, setList] = useState<Row[]>([]);
  const [d, setD] = useState<Draft | null>(null);
  const load = useCallback(() => api("/api/suppliers").then(setList).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { load(); }, [load]);

  async function run(code: string, name: string) {
    if (!confirm(`${name} XML'i ürün veritabanına aktarılsın mı? Var olanlar güncellenir, XML'den kalkanların stoğu 0 olur, hiçbir şey silinmez. Pazaryerlerine bir şey gönderilmez.`)) return;
    try { await api("/api/import", { method: "POST", body: JSON.stringify({ supplier: code }) }); notify("good", `${name} içe aktarma başlatıldı (GitHub Actions). Büyük XML'de ilk sefer 5-10 dakika sürebilir; sonuç "İçe aktar" sekmesindeki geçmişte görünür.`); }
    catch (e: any) { notify("err", e.message); }
  }
  async function toggle(s: Row, k: "active" | "nightly") {
    try { await api("/api/suppliers", { method: "PUT", body: JSON.stringify({ id: s.id, [k]: !s[k] }) }); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function remove(s: Row) {
    if (!confirm(`"${s.name}" tedarikçisi silinsin mi? Ürünleri veritabanında kalır (istersen Ürün listesinden arşivleyebilirsin).`)) return;
    try { await api(`/api/suppliers?id=${s.id}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  if (d) return <Editor api={api} notify={notify} initial={d} onClose={() => { setD(null); load(); }} />;
  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Tedarikçiler ({list.length})</h2>
          <div className="row">
            {list.length > 1 && <button className="btn" onClick={() => run("all", "Tüm aktif tedarikçilerin")}>Hepsini içe aktar</button>}
            <button className="btn primary" onClick={() => setD(empty())}>+ Tedarikçi ekle</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Her tedarikçinin XML'i ürün veritabanına kendi kaynak adıyla (xml:kod) girer. Bir tedarikçinin birden çok XML linki varsa düzenle → "Ek XML linkleri":
          hepsi birlikte indirilir ve tek tedarikçi olarak görünür. "Otomatik" işaretliler saatte bir (her saat :45) kendiliğinden güncellenir: stok ve fiyat tedarikçiyle eşit kalır.
        </p>
        {list.length === 0 ? <p className="muted">Henüz tedarikçi yok.</p> : <div className="scroll"><table className="cards">
          <thead><tr><th>Tedarikçi</th><th className="n">Ürün</th><th>Son içe aktarma</th><th>Aktif</th><th>Otomatik</th><th /></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b> <span className="muted">({s.code})</span><br /><span className="muted" style={{ fontSize: 12 }}>{s.url_masked || "adres yok"}{s.feeds?.length ? ` · +${s.feeds.length} ek link` : ""}{s.sku_prefix ? ` · SKU öneki ${s.sku_prefix}` : ""}</span></td>
              <td data-label="Ürün" className="n">{Number(s.product_count).toLocaleString("tr-TR")}</td>
              <td data-label="Son içe aktarma" style={{ fontSize: 13 }}>{s.last_run_at ? <>{when(s.last_run_at)} <span className={`pill ${s.last_status === "ok" ? "ok" : s.last_status === "error" ? "error" : "partial"}`}>{STATUS_TR[s.last_status] ?? s.last_status}</span></> : <span className="muted">hiç</span>}</td>
              <td data-label="Aktif"><input type="checkbox" checked={s.active} onChange={() => toggle(s, "active")} /></td>
              <td data-label="Otomatik (saatlik)"><input type="checkbox" checked={s.nightly} disabled={!s.active} onChange={() => toggle(s, "nightly")} /></td>
              <td className="n"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                <button className="btn primary" disabled={!s.active || !s.has_url} onClick={() => run(s.code, s.name)}>İçe aktar</button>
                <button className="btn" onClick={() => setD({ ...empty(), ...s, feeds: (s.feeds ?? []).map((f: Row) => ({ id: f.id, label: f.label ?? "", url: "", url_masked: f.url_masked, sku_prefix: f.sku_prefix ?? "", mapping: f.mapping ?? null, item_path: f.item_path ?? "", own: !!f.mapping })), xml_url: "", item_path: s.item_path ?? "", marketplace_brand: s.marketplace_brand ?? "", default_attributes: Object.entries(s.default_attributes ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n") })}>Düzenle</button>
                <button className="btn danger" onClick={() => remove(s)}>Sil</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </div>
    </>
  );
}

function Editor({ api, notify, initial, onClose }: { api: Api; notify: Notify; initial: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [info, setInfo] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  const isNew = !d.id;
  const set = (k: keyof Draft, v: any) => setD((p) => ({ ...p, [k]: v }));
  const settings = { sku_prefix: d.sku_prefix, sku_ascii: d.sku_ascii, price_includes_vat: d.price_includes_vat, default_vat: d.default_vat, default_brand: d.default_brand, currency: d.currency };

  async function inspect(useMapping: boolean) {
    setBusy("XML indiriliyor ve inceleniyor (büyük dosyada 1 dakikayı bulabilir)...");
    try {
      const r = await api("/api/suppliers/inspect", { method: "POST", body: JSON.stringify({ id: d.xml_url ? undefined : d.id, url: d.xml_url || undefined, item_path: d.item_path || undefined, mapping: useMapping ? d.mapping : undefined, ...settings }) });
      setInfo(r);
      setD((p) => ({ ...p, item_path: p.item_path || r.item_path, mapping: useMapping && Object.keys(p.mapping).length ? p.mapping : r.mapping }));
    } catch (e: any) { notify("err", e.message); }
    finally { setBusy(""); }
  }
  const setFeed = (i: number, patch: Partial<FeedDraft>) => setD((p) => ({ ...p, feeds: p.feeds.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  async function inspectFeed(i: number) {
    const f = d.feeds[i];
    setBusy(`${f.label || "Ek link"} inceleniyor...`);
    try {
      const own = f.own && f.mapping && Object.keys(f.mapping).length ? f.mapping : null;
      const r = await api("/api/suppliers/inspect", { method: "POST", body: JSON.stringify({ ...(f.url ? { url: f.url } : { id: d.id, feed_id: f.id }), item_path: f.item_path || d.item_path || undefined, mapping: own ?? (f.own ? undefined : d.mapping), ...settings, sku_prefix: f.sku_prefix || d.sku_prefix }) });
      setFeed(i, { info: r, item_path: f.item_path || (r.item_path !== d.item_path ? r.item_path : ""), mapping: f.own ? own ?? r.mapping : f.mapping });
    } catch (e: any) { notify("err", e.message); }
    finally { setBusy(""); }
  }
  async function save() {
    setBusy("Kaydediliyor...");
    try {
      const feeds = d.feeds.map((f) => ({ id: f.id, label: f.label, url: f.url || undefined, sku_prefix: f.sku_prefix, mapping: f.own ? f.mapping : null, item_path: f.item_path }));
      await api("/api/suppliers", { method: "PUT", body: JSON.stringify({ ...d, feeds, xml_url: d.xml_url || undefined, code: isNew ? d.code : undefined }) });
      notify("good", `${d.name} kaydedildi. Listeden "İçe aktar" ile ürünleri alabilirsin.`); onClose();
    } catch (e: any) { notify("err", e.message); }
    finally { setBusy(""); }
  }

  const mappedFields = Object.values(d.mapping);
  const paths: { path: string; fill?: number; samples?: string[] }[] = info?.fields ?? Object.keys(d.mapping).map((path) => ({ path }));
  const feedsOk = d.feeds.every((f) => (f.url || f.id) && (!f.own || (f.mapping && Object.keys(f.mapping).length)));
  const canSave = d.name.trim() && (isNew ? d.code && d.xml_url : true) && mappedFields.some((f) => f === "model" || f === "variant_sku") && mappedFields.includes("title") && feedsOk;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={onClose}>← Tedarikçiler</button>
        <h2 style={{ margin: 0 }}>{isNew ? "Yeni tedarikçi" : d.name}</h2>
      </div>

      <div className="card">
        <h2>1. XML adresi</h2>
        <div className="grid">
          <label className="f">Tedarikçi adı<input type="text" value={d.name} placeholder="ör. Toptan Market" onChange={(e) => { set("name", e.target.value); if (isNew) setD((p) => ({ ...p, name: e.target.value, code: slugify(e.target.value), sku_prefix: p.sku_prefix || "" })); }} /></label>
          {isNew && <label className="f">Kısa kod<input type="text" value={d.code} onChange={(e) => set("code", slugify(e.target.value))} /><small>Ürün kaynağı xml:{d.code || "kod"} olur, sonradan değişmez</small></label>}
        </div>
        <label className="f" style={{ marginTop: 12 }}>XML adresi {!isNew && <span className="muted">(kayıtlı: {d.url_masked || "yok"}; değiştirmek için yeni adres yaz)</span>}
          <input type="text" value={d.xml_url} placeholder="https://tedarikci.com/xml/urunler.xml?key=..." onChange={(e) => set("xml_url", e.target.value)} />
          <small>Adres yalnızca sunucuda saklanır, panelde gizli gösterilir.</small>
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!!busy || (!d.xml_url && (isNew || !!d.url_from_env))} onClick={() => inspect(false)}>XML'i incele</button>
          {d.url_from_env && !d.xml_url && <span className="muted" style={{ fontSize: 13 }}>Adres GitHub Secret'ta, panelden incelenemez; eşleme aşağıda düzenlenebilir.</span>}
          {busy && <span className="muted">{busy}</span>}
        </div>
        {info && <p style={{ marginBottom: 0 }}>✓ {info.count.toLocaleString("tr-TR")} ürün bulundu ({info.sizeMb} MB), ürün listesi yolu: <code>{info.item_path}</code>{info.suggested && " · alanlar otomatik eşlendi, kontrol et"}</p>}

        <h3 style={{ margin: "18px 0 4px" }}>Ek XML linkleri ({d.feeds.length})</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Aynı tedarikçinin diğer listeleri. Hepsi birlikte indirilir, ürünler bu tedarikçiye (xml:{d.code || "kod"}) yazılır; biri inmezse içe aktarma durur ve hiçbir stok sıfırlanmaz.
          SKU öneki ve alan eşlemesi boşsa ana linkinki kullanılır.
        </p>
        {d.feeds.map((f, i) => (
          <div key={f.id ?? `yeni-${i}`} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div className="grid">
              <label className="f">Ad<input type="text" value={f.label} placeholder={`Link ${i + 2}`} onChange={(e) => setFeed(i, { label: e.target.value })} /></label>
              <label className="f">SKU öneki<input type="text" value={f.sku_prefix} placeholder={d.sku_prefix || "ana linkle aynı"} onChange={(e) => setFeed(i, { sku_prefix: e.target.value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 12) })} /><small>Linkler arasında kod çakışmasın diye farklı olabilir</small></label>
            </div>
            <label className="f" style={{ marginTop: 8 }}>XML adresi {f.url_masked && <span className="muted">(kayıtlı: {f.url_masked}; değiştirmek için yeni adres yaz)</span>}
              <input type="text" value={f.url} placeholder="https://..." onChange={(e) => setFeed(i, { url: e.target.value, info: null })} />
            </label>
            <div className="row" style={{ gap: 12, marginTop: 8, flexWrap: "wrap" }}>
              <label className="check"><input type="checkbox" checked={f.own} onChange={(e) => setFeed(i, { own: e.target.checked, mapping: e.target.checked ? f.mapping : null })} />Bu linkin alan yapısı farklı (kendi eşlemesi)</label>
              <button className="btn" disabled={!!busy || (!f.url && !f.id)} onClick={() => inspectFeed(i)}>İncele</button>
              <button className="btn danger" onClick={() => setD((p) => ({ ...p, feeds: p.feeds.filter((_, j) => j !== i) }))}>Kaldır</button>
            </div>
            {f.own && <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>{f.mapping && Object.keys(f.mapping).length ? `Kendi eşlemesi: ${Object.keys(f.mapping).length} alan (incelemede otomatik önerildi)` : "Kendi eşlemesi için önce İncele'ye bas."}</p>}
            {f.info && (() => {
              const bad = (f.info.preview ?? []).filter((x: Row) => x.error).length;
              return <p style={{ fontSize: 13, margin: "6px 0 0" }}>✓ {Number(f.info.count).toLocaleString("tr-TR")} ürün ({f.info.sizeMb} MB){bad ? <span style={{ color: "var(--warn)" }}> · önizlemede {bad} ürün okunamadı{!f.own ? ": alan yapısı farklı olabilir, \"kendi eşlemesi\"ni işaretleyip yeniden incele" : ""}</span> : " · önizleme sorunsuz"}{f.info.preview?.find((x: Row) => x.payload) ? ` · örnek SKU: ${f.info.preview.find((x: Row) => x.payload).payload.sku}` : ""}</p>;
            })()}
          </div>
        ))}
        <button className="btn" onClick={() => setD((p) => ({ ...p, feeds: [...p.feeds, { label: "", url: "", sku_prefix: "", mapping: null, item_path: "", own: false }] }))}>+ Ek link</button>
      </div>

      {(info || Object.keys(d.mapping).length > 0) && <div className="card">
        <h2>2. Alan eşleme</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          XML'deki her alanın panelde neye karşılık geldiğini seç. Zorunlu: <b>Model kodu</b> ve <b>Ürün adı</b>. Aynı model kodlu ürünler tek ürünün renk/beden seçenekleri olur;
          her XML ürünü ayrı ürünse varyant alanlarını boş bırak.
        </p>
        <div className="scroll" style={{ maxHeight: 420, overflowY: "auto" }}><table>
          <thead><tr><th>XML alanı</th><th>Örnek</th><th className="n">Dolu</th><th>Panelde</th></tr></thead>
          <tbody>{paths.map((f) => (
            <tr key={f.path}>
              <td><code style={{ fontSize: 12 }}>{f.path}</code></td>
              <td className="muted" style={{ fontSize: 12, maxWidth: 280, wordBreak: "break-word" }}>{(f.samples ?? []).join(" · ").slice(0, 160)}</td>
              <td className="n">{f.fill != null ? `%${f.fill}` : ""}</td>
              <td style={{ width: 170 }}>
                <select value={d.mapping[f.path] ?? ""} onChange={(e) => { const m = { ...d.mapping }; if (e.target.value) m[f.path] = e.target.value as Field; else delete m[f.path]; set("mapping", m); }}>
                  <option value="">— kullanma —</option>
                  {FIELDS.map((x) => <option key={x} value={x}>{FIELD_LABEL[x]}</option>)}
                </select>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        {!mappedFields.some((f) => f === "model" || f === "variant_sku") && <p style={{ color: "var(--bad)" }}>"Model kodu" seçilmedi.</p>}
        {!mappedFields.includes("title") && <p style={{ color: "var(--bad)" }}>"Ürün adı" seçilmedi.</p>}
        {!mappedFields.includes("cost_price") && <p style={{ color: "var(--warn)" }}>"Alış fiyatı" seçilmedi: fiyat hesaplanamaz.</p>}
        {!mappedFields.includes("stock") && <p style={{ color: "var(--warn)" }}>"Stok" seçilmedi: stoklar 0 görünür.</p>}
      </div>}

      {(info || !isNew) && <div className="card">
        <h2>3. Ayarlar</h2>
        <div className="grid">
          <label className="f">SKU öneki<input type="text" value={d.sku_prefix} placeholder="ör. TM-" onChange={(e) => set("sku_prefix", e.target.value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 12))} /><small>Tedarikçiler arasında kod çakışmasın diye (ör. TM-12345)</small></label>
          <label className="f">Sabit marka<input type="text" value={d.default_brand} placeholder="boş = XML'deki marka" onChange={(e) => set("default_brand", e.target.value)} /><small>XML markası pazaryerinde yoksa (ör. Eco Lounge)</small></label>
          <label className="f">Pazaryeri markası<input type="text" value={d.marketplace_brand} placeholder="boş = gönderilmez" onChange={(e) => set("marketplace_brand", e.target.value)} /><small>Ürünler Trendyol vb.'de bu markayla açılır (ör. Tcx). <b>*</b> yazarsan her ürün XML'deki kendi markasıyla gider (tedarikçinin markalarını kullanma iznin varsa). Başkasına ait markada yetki belgesi al</small></label>
          <label className="f" style={{ gridColumn: "1 / -1" }}>Varsayılan ürün özellikleri<textarea value={d.default_attributes} placeholder={"Menşei = Çin\nGaranti Süresi = 2 Yıl"} style={{ minHeight: 70, fontFamily: "inherit" }} onChange={(e) => set("default_attributes", e.target.value)} /><small>Pazaryeri zorunlu özelliği XML'de yoksa bu değer kullanılır (satır başına "Özellik = Değer"). Yalnızca tedarikçiden teyit ettiğin bilgileri gir</small></label>
          <label className="f">Fiyatlar
            <select value={d.price_includes_vat ? "1" : "0"} onChange={(e) => set("price_includes_vat", e.target.value === "1")}><option value="1">KDV dahil</option><option value="0">KDV hariç (KDV eklenir)</option></select>
          </label>
          <label className="f">Varsayılan KDV
            <select value={d.default_vat} onChange={(e) => set("default_vat", Number(e.target.value))}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select><small>XML'de KDV yoksa</small>
          </label>
          <label className="f">Para birimi (XML'de yoksa)
            <select value={d.currency} onChange={(e) => set("currency", e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></select>
          </label>
          <label className="f">Ürün listesi yolu<input type="text" value={d.item_path} placeholder="otomatik" onChange={(e) => set("item_path", e.target.value)} /><small>Genelde otomatik bulunur</small></label>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 16 }}>
          <label className="check"><input type="checkbox" checked={d.sku_ascii} onChange={(e) => set("sku_ascii", e.target.checked)} />SKU'dan Türkçe/özel karakterleri at</label>
          <label className="check" title="Ör. Toptancım: aynı ürün ABC, ABC-1, ABC-2... kodlarıyla farklı başlıkla tekrar yayınlanıyor"><input type="checkbox" checked={!!d.dedupe_code_suffix} onChange={(e) => set("dedupe_code_suffix", e.target.checked)} />Kod sonu -1, -2... olan kopyalardan pazaryerine yalnızca stokta olan en ucuzunu gönder</label>
          <label className="check"><input type="checkbox" checked={d.nightly} onChange={(e) => set("nightly", e.target.checked)} />Saatte bir otomatik içe aktar</label>
        </div>
      </div>}

      {info?.preview && <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>4. Önizleme (ilk ürünler)</h2>
          <button className="btn" disabled={!!busy} onClick={() => inspect(true)}>Eşleme ve ayarlarla yenile</button>
        </div>
        <div className="scroll" style={{ marginTop: 8 }}><table>
          <thead><tr><th>SKU</th><th>Ürün adı</th><th>Marka</th><th className="n">Alış</th><th className="n">Stok</th><th className="n">Seçenek</th><th className="n">Görsel</th></tr></thead>
          <tbody>{info.preview.map((p: Row) => p.error
            ? <tr key={p.row}><td colSpan={7} style={{ color: "var(--bad)" }}>{p.row}. ürün: {p.error}</td></tr>
            : <tr key={p.row}>
              <td style={{ fontSize: 13 }}>{p.payload.sku}</td><td>{p.payload.title}<br /><span className="muted" style={{ fontSize: 12 }}>{p.payload.category}</span></td>
              <td>{p.payload.brand || <span className="muted">-</span>}</td>
              <td className="n">{p.payload.cost_price != null ? `${p.payload.currency === "TRY" ? tl(p.payload.cost_price) : `${p.payload.cost_price} ${p.payload.currency}`}` : <span style={{ color: "var(--warn)" }}>yok</span>}</td>
              <td className="n">{p.payload.variants.reduce((t: number, v: Row) => t + v.stock, 0)}</td>
              <td className="n">{p.payload.variants.length}</td>
              <td className="n">{p.payload.images?.length ?? 0}</td>
            </tr>)}</tbody>
        </table></div>
      </div>}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn primary" disabled={!!busy || !canSave} onClick={save}>{isNew ? "Tedarikçiyi kaydet" : "Değişiklikleri kaydet"}</button>
        <button className="btn" onClick={onClose}>Vazgeç</button>
        {isNew && !info && <span className="muted">Önce XML'i incele.</span>}
      </div>
    </>
  );
}
