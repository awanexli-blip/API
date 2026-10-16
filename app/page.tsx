"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import { calcPrice, defaultConfig } from "@/worker/pricing";

type Row = Record<string, any>;
type Tab = "ozet" | "ayarlar" | "kategoriler" | "ozel";

const TABS: [Tab, string][] = [
  ["ozet", "Özet"],
  ["ayarlar", "Fiyat ve stok ayarları"],
  ["kategoriler", "Kategoriler"],
  ["ozel", "Ürün istisnaları"],
];

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
const when = (s?: string) => (s ? new Date(s).toLocaleString("tr-TR") : "-");

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  return session ? <Panel token={session.access_token} /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setErr("E-posta veya şifre hatalı");
    setBusy(false);
  }

  return (
    <div className="login card">
      <h1>Trendyol Kontrol Paneli</h1>
      <p className="muted">Devam etmek için giriş yap.</p>
      {err && <div className="msg err">{err}</div>}
      <form onSubmit={submit} className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <label className="f">E-posta<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="f">Şifre<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        <button className="btn primary" disabled={busy}>Giriş yap</button>
      </form>
    </div>
  );
}

function Panel({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("ozet");
  const [msg, setMsg] = useState<{ t: "err" | "good"; m: string } | null>(null);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Hata ${res.status}`);
      return data;
    },
    [token]
  );

  // useCallback: aksi halde her mesajda yeni fonksiyon -> alt sekmelerin load() efekti tekrar çalışır -> hata varsa sonsuz döngü
  const notify = useCallback((t: "err" | "good", m: string) => { setMsg({ t, m }); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);

  return (
    <div className="wrap">
      <div className="top">
        <h1>Trendyol Kontrol Paneli</h1>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Çıkış yap</button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => { setTab(k); setMsg(null); }}>{label}</button>
        ))}
      </div>
      {msg && <div className={`msg ${msg.t}`} role="status">{msg.m}</div>}
      {tab === "ozet" && <Overview api={api} notify={notify} />}
      {tab === "ayarlar" && <Settings api={api} notify={notify} />}
      {tab === "kategoriler" && <Categories api={api} notify={notify} />}
      {tab === "ozel" && <Overrides api={api} notify={notify} />}
    </div>
  );
}

type Props = { api: (p: string, i?: RequestInit) => Promise<any>; notify: (t: "err" | "good", m: string) => void };

/* ---------------------------------------------------------------- Özet */

const ACTIONS: { mode: string; label: string; hint: string; confirm?: string; primary?: boolean }[] = [
  { mode: "preview", label: "Önizleme", hint: "Fiyatları hesaplar, Trendyol'a hiçbir şey göndermez." },
  { mode: "update", label: "Stok ve fiyatı güncelle", hint: "Trendyol'daki mevcut ürünleri günceller.", confirm: "Trendyol'daki mevcut ürünlerin stok ve fiyatı güncellensin mi?", primary: true },
  { mode: "create", label: "Yeni ürünleri aç", hint: "Trendyol'da olmayan, kategorisi eşleşmiş ürünleri açar.", confirm: "Kategorisi eşleşmiş yeni ürünler Trendyol'da açılsın mı?" },
];

function Overview({ api, notify }: Props) {
  const [runs, setRuns] = useState<Row[]>([]);
  const [s, setS] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  const [toggling, setToggling] = useState(false);

  // Ayarlar ve geçmiş ayrı yüklenir: biri hata verirse diğeri yine görünür
  const load = useCallback(async () => {
    const [st, rn] = await Promise.allSettled([api("/api/settings"), api("/api/runs")]);
    if (st.status === "fulfilled") setS(st.value); else notify("err", "Ayarlar okunamadı: " + st.reason?.message);
    if (rn.status === "fulfilled") setRuns(rn.value); else notify("err", "Çalıştırma geçmişi okunamadı: " + rn.reason?.message);
  }, [api, notify]);

  useEffect(() => { load(); }, [load]);
  // 1 saatten eski "running" kayıtlar yarıda kalmış sayılır, sonsuz yenilemeye sokmasın
  const running = runs.some((r) => r.status === "running" && Date.now() - new Date(r.started_at).getTime() < 3600_000);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [running, load]);

  async function start(mode: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(mode);
    try {
      await api("/api/run", { method: "POST", body: JSON.stringify({ mode }) });
      notify("good", "İş başlatıldı. GitHub Actions çalışmaya başlayınca aşağıdaki listede görünür (1-2 dakika).");
      setTimeout(load, 15000);
    } catch (e: any) { notify("err", e.message); }
    setBusy("");
  }

  async function toggleAuto() {
    if (!s || toggling) return;
    const next = !s.auto_sync;
    if (next && !confirm("Otomatik senkronizasyon açılsın mı? Her 4 saatte bir Trendyol'daki stok ve fiyatlar güncellenir.")) return;
    setToggling(true);
    try {
      const d = await api("/api/settings", { method: "PUT", body: JSON.stringify({ auto_sync: next }) });
      setS(d);
      if (d.auto_sync !== next) notify("err", "Ayar kaydedilemedi, sayfayı yenileyip tekrar dene.");
      else notify("good", next ? "Otomatik senkronizasyon açıldı. İlk çalışma bir sonraki 4 saatlik dilimde (03:00, 07:00, 11:00, 15:00, 19:00, 23:00 TR saati)." : "Otomatik senkronizasyon duraklatıldı.");
    } catch (e: any) { notify("err", "Kaydedilemedi: " + e.message); }
    setToggling(false);
  }

  return (
    <>
      <div className="card">
        <h2>Otomatik senkronizasyon</h2>
        <p className="muted">GitHub Actions her 4 saatte bir XML'i çeker, stok ve fiyatı hesaplar, Trendyol'a gönderir.</p>
        <div className="row">
          <span className={`pill ${s?.auto_sync ? "ok" : "partial"}`}>{s ? (s.auto_sync ? "Açık" : "Duraklatıldı") : "..."}</span>
          <button className={`btn ${s?.auto_sync ? "" : "primary"}`} onClick={toggleAuto} disabled={!s || toggling}>{toggling ? "Kaydediliyor..." : s?.auto_sync ? "Duraklat" : "Aç"}</button>
          {s?.updated_at && <span className="muted" style={{ fontSize: 13 }}>son değişiklik: {when(s.updated_at)}</span>}
        </div>
      </div>

      <div className="card">
        <h2>Şimdi çalıştır</h2>
        <div className="grid">
          {ACTIONS.map((a) => (
            <div key={a.mode}>
              <button className={`btn ${a.primary ? "primary" : ""}`} disabled={!!busy} onClick={() => start(a.mode, a.confirm)}>
                {busy === a.mode ? "Başlatılıyor..." : a.label}
              </button>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{a.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Son çalıştırmalar</h2>
          <button className="btn" onClick={load}>Yenile</button>
        </div>
        {runs.length === 0 ? (
          <p className="muted">Henüz çalıştırma yok. Önce "Önizleme" ile başla.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead><tr><th>Zaman</th><th>Mod</th><th>Durum</th><th>Sonuç</th></tr></thead>
              <tbody>
                {runs.map((r) => {
                  const m = r.summary ?? {};
                  return (
                    <tr key={r.id}>
                      <td>{when(r.started_at)}</td>
                      <td>{r.mode}{r.trigger === "schedule" ? " (zamanlı)" : ""}</td>
                      <td><span className={`pill ${r.status}`}>{statusTr[r.status] ?? r.status}</span></td>
                      <td>
                        {r.error ? <span style={{ color: "var(--bad)" }}>{r.error}</span>
                          : m.skippedRun ? <span className="muted">{m.skippedRun}</span>
                          : m.xml != null ? (
                            <>
                              XML {m.xml} · Trendyol {m.trendyol} · eşleşen {m.matched}<br />
                              güncellenen {m.updated} · açılan {m.created}{m.zeroed ? ` · sıfırlanan ${m.zeroed}` : ""}{m.failedBatches ? ` · hatalı paket ${m.failedBatches}` : ""}
                              <details><summary>Ayrıntı</summary><pre>{JSON.stringify(m, null, 1)}</pre></details>
                            </>
                          ) : <span className="muted">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const statusTr: Record<string, string> = { ok: "Tamam", error: "Hata", partial: "Kısmen", running: "Çalışıyor", skipped: "Atlandı" };

/* -------------------------------------------------------------- Ayarlar */

type Field = { key: string; label: string; kind: "pct" | "num" | "int"; hint?: string };
const FIELDS: Field[] = [
  { key: "target_profit_rate", label: "Hedef net kâr (%)", kind: "pct", hint: "Satış fiyatının yüzdesi" },
  { key: "commission_rate", label: "Varsayılan komisyon (%)", kind: "pct", hint: "Kategoriye özel oranı Kategoriler sekmesinde girebilirsin" },
  { key: "shipping_cost", label: "Kargo ücreti (TL)", kind: "num" },
  { key: "free_shipping_threshold", label: "Kargo eşiği (TL)", kind: "num", hint: "Bu fiyat ve üstünde kargoyu sen ödersin" },
  { key: "min_markup", label: "En düşük çarpan", kind: "num", hint: "Fiyat en az maliyet × bu değer olur" },
  { key: "fixed_cost", label: "Ürün başı sabit gider (TL)", kind: "num", hint: "Paketleme vb." },
  { key: "min_acceptable_profit_rate", label: "Eşik altına çekmede en düşük kâr (%)", kind: "pct", hint: "Fiyat 299,90'a sabitlenirse kabul edilen en düşük kâr" },
  { key: "max_price", label: "En yüksek satış fiyatı (TL)", kind: "num", hint: "Bunun üstündeki ürünler atlanır" },
  { key: "min_stock", label: "Minimum stok", kind: "int", hint: "Bunun altındaysa Trendyol'a 0 gönderilir" },
  { key: "vat_rate", label: "Varsayılan KDV (%)", kind: "num" },
  { key: "fx_usd", label: "USD kuru (TL)", kind: "num", hint: "XML'de döviz USD ise gerekli" },
  { key: "fx_eur", label: "EUR kuru (TL)", kind: "num", hint: "XML'de döviz EUR ise gerekli" },
];
const BOOLS: [string, string][] = [
  ["auto_create", "Yeni ürünleri de otomatik aç (kapalıysa sadece mevcutlar güncellenir)"],
  ["update_prices", "Fiyatları da güncelle (kapalıysa sadece stok gönderilir)"],
  ["zero_missing", "XML'den kalkan ürünlerin stoğunu sıfırla"],
];

function Settings({ api, notify }: Props) {
  const [f, setF] = useState<Row | null>(null); // ekranda gösterilen değerler (yüzde alanları ×100)

  const toForm = (d: Row) => {
    const o: Row = { ...d };
    for (const x of FIELDS) if (x.kind === "pct") o[x.key] = String(Math.round(Number(d[x.key]) * 10000) / 100);
    for (const x of FIELDS) if (x.kind !== "pct") o[x.key] = String(d[x.key]);
    return o;
  };

  useEffect(() => { api("/api/settings").then((d) => setF(toForm(d))).catch((e) => notify("err", e.message)); /* eslint-disable-next-line */ }, [api]);
  if (!f) return <p className="muted">Yükleniyor...</p>;

  const num = (k: string) => Number(String(f[k]).replace(",", "."));
  const cfg = {
    ...defaultConfig,
    commissionRate: num("commission_rate") / 100, targetProfitRate: num("target_profit_rate") / 100,
    shippingCost: num("shipping_cost"), freeShippingThreshold: num("free_shipping_threshold"),
    minMarkup: num("min_markup"), fixedCost: num("fixed_cost"),
    minAcceptableProfitRate: num("min_acceptable_profit_rate") / 100, maxPrice: num("max_price"),
  };
  const valid = Object.values(cfg).every((v) => Number.isFinite(v)) && cfg.commissionRate + cfg.targetProfitRate < 1;

  async function save() {
    const body: Row = {};
    for (const x of FIELDS) {
      const v = Number(String(f![x.key]).replace(",", "."));
      body[x.key] = x.kind === "pct" ? v / 100 : v;
    }
    for (const [k] of BOOLS) body[k] = f![k];
    body.existing_price_policy = f!.existing_price_policy;
    try { setF(toForm(await api("/api/settings", { method: "PUT", body: JSON.stringify(body) }))); notify("good", "Ayarlar kaydedildi. Bir sonraki senkronizasyonda geçerli olur."); }
    catch (e: any) { notify("err", e.message); }
  }

  return (
    <>
      <div className="card">
        <h2>Fiyat ve stok ayarları</h2>
        <div className="grid">
          {FIELDS.map((x) => (
            <label className="f" key={x.key}>{x.label}
              <input type="text" inputMode="decimal" value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
              {x.hint && <small>{x.hint}</small>}
            </label>
          ))}
        </div>
        <h3>Mevcut ürünlerin fiyatı</h3>
        <label className="f" style={{ maxWidth: 520 }}>Trendyol'da zaten olan ürünlerde fiyat nasıl güncellensin?
          <select value={f.existing_price_policy ?? "floor"} onChange={(e) => setF({ ...f, existing_price_policy: e.target.value })}>
            <option value="floor">Sadece formülün altındaysa yükselt, mevcut fiyatı asla düşürme (önerilen)</option>
            <option value="keep">Fiyata dokunma, sadece stok güncelle</option>
            <option value="formula">Her ürünü formül fiyatına eşitle (fiyatlar düşebilir)</option>
          </select>
        </label>
        <h3>Davranış</h3>
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          {BOOLS.map(([k, label]) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={save} disabled={!valid}>Ayarları kaydet</button>
          {!valid && <span className="muted">Değerleri kontrol et. Komisyon ve kâr toplamı %100'den küçük olmalı.</span>}
        </div>
      </div>

      <div className="card">
        <h2>Fiyat simülasyonu</h2>
        <p className="muted">Yukarıdaki değerlerle örnek maliyetlerin satış fiyatı. Kaydetmeden denemek için değerleri değiştir.</p>
        {valid ? (
          <div className="scroll">
            <table className="sim">
              <thead><tr><th className="n">Maliyet</th><th className="n">Satış fiyatı</th><th>Kargo</th><th className="n">Net kâr</th><th className="n">Kâr oranı</th><th /></tr></thead>
              <tbody>
                {[30, 60, 100, 150, 200, 214, 250, 300, 400, 600, 1000].map((c) => {
                  const r = calcPrice(c, cfg as any);
                  return r.ok ? (
                    <tr key={c}>
                      <td className="n">{tl(c)}</td>
                      <td className="n"><strong>{tl(r.price)}</strong></td>
                      <td>{r.sellerPaysShipping ? "Sen ödersin" : "Alıcı öder"}</td>
                      <td className="n">{tl(r.netProfit)}</td>
                      <td className="n">%{(r.profitRate * 100).toFixed(1)}</td>
                      <td className="muted">{r.note ?? ""}</td>
                    </tr>
                  ) : (
                    <tr key={c}><td className="n">{tl(c)}</td><td colSpan={5} className="warn">Atlanır: {r.reason}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Geçerli değerler girince tablo görünür.</p>}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- Kategoriler */

const emptyDraft = { xml_category: "", category_id: "", commission_rate: "", vat_rate: "", attributes: "" };

function Categories({ api, notify }: Props) {
  const [mapped, setMapped] = useState<Row[]>([]);
  const [unmapped, setUnmapped] = useState<Row[]>([]);
  const [d, setD] = useState<Row>(emptyDraft);

  const load = useCallback(async () => {
    try { const r = await api("/api/categories"); setMapped(r.mapped); setUnmapped(r.unmapped); } catch (e: any) { notify("err", e.message); }
  }, [api, notify]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      await api("/api/categories", {
        method: "PUT",
        body: JSON.stringify({
          xml_category: d.xml_category, category_id: d.category_id,
          commission_rate: d.commission_rate === "" ? "" : Number(String(d.commission_rate).replace(",", ".")) / 100,
          vat_rate: d.vat_rate, attributes: d.attributes,
        }),
      });
      notify("good", "Kategori eşleşmesi kaydedildi."); setD(emptyDraft); load();
    } catch (e: any) { notify("err", e.message); }
  }

  async function remove(name: string) {
    if (!confirm(`"${name}" eşleşmesi silinsin mi?`)) return;
    try { await api(`/api/categories?xml_category=${encodeURIComponent(name)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  const edit = (c: Row) => {
    setD({
      xml_category: c.xml_category, category_id: String(c.category_id),
      commission_rate: c.commission_rate == null ? "" : String(Math.round(Number(c.commission_rate) * 10000) / 100),
      vat_rate: c.vat_rate == null ? "" : String(c.vat_rate),
      attributes: c.attributes?.length ? JSON.stringify(c.attributes) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <div className="card">
        <h2>Kategori eşleştir</h2>
        <p className="muted">XML'deki kategori adını Trendyol kategori ID'si ile eşleştir. Eşleşmeyen kategorideki yeni ürünler açılmaz.</p>
        <div className="grid">
          <label className="f">XML kategori adı<input type="text" value={d.xml_category} onChange={(e) => setD({ ...d, xml_category: e.target.value })} /></label>
          <label className="f">Trendyol kategori ID<input type="text" inputMode="numeric" value={d.category_id} onChange={(e) => setD({ ...d, category_id: e.target.value })} /></label>
          <label className="f">Komisyon (%)<input type="text" inputMode="decimal" value={d.commission_rate} onChange={(e) => setD({ ...d, commission_rate: e.target.value })} /><small>Boşsa varsayılan komisyon kullanılır</small></label>
          <label className="f">KDV (%)<input type="text" inputMode="decimal" value={d.vat_rate} onChange={(e) => setD({ ...d, vat_rate: e.target.value })} /><small>Boşsa varsayılan KDV</small></label>
        </div>
        <label className="f" style={{ marginTop: 12 }}>Zorunlu özellikler (JSON, isteğe bağlı)
          <textarea value={d.attributes} placeholder='[{"attributeId": 47, "attributeValueId": 1234}]' onChange={(e) => setD({ ...d, attributes: e.target.value })} />
          <small>Trendyol bazı kategorilerde renk, beden gibi özellikleri zorunlu tutar.</small>
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={save}>Eşleşmeyi kaydet</button>
          <button className="btn" onClick={() => setD(emptyDraft)}>Temizle</button>
        </div>
      </div>

      <div className="card">
        <h2>Eşleşmeyen kategoriler ({unmapped.length})</h2>
        {unmapped.length === 0 ? <p className="muted">Eşleşmeyen kategori yok. Liste her önizleme veya senkronizasyondan sonra güncellenir.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>XML kategorisi</th><th className="n">Yeni ürün</th><th /></tr></thead>
            <tbody>{unmapped.map((u) => (
              <tr key={u.xml_category}><td>{u.xml_category}</td><td className="n">{u.product_count}</td>
                <td className="n"><button className="btn" onClick={() => edit({ xml_category: u.xml_category, category_id: "", attributes: [] })}>Eşleştir</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Eşleşenler ({mapped.length})</h2>
        {mapped.length === 0 ? <p className="muted">Henüz eşleşme yok.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>XML kategorisi</th><th className="n">Trendyol ID</th><th className="n">Komisyon</th><th className="n">KDV</th><th /></tr></thead>
            <tbody>{mapped.map((c) => (
              <tr key={c.xml_category}>
                <td>{c.xml_category}</td><td className="n">{c.category_id}</td>
                <td className="n">{c.commission_rate == null ? "-" : `%${Math.round(Number(c.commission_rate) * 10000) / 100}`}</td>
                <td className="n">{c.vat_rate == null ? "-" : `%${c.vat_rate}`}</td>
                <td className="n"><div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn" onClick={() => edit(c)}>Düzenle</button>
                  <button className="btn danger" onClick={() => remove(c.xml_category)}>Sil</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- Istisnalar */

function Overrides({ api, notify }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [d, setD] = useState<Row>({ barcode: "", price_override: "", hidden: false, note: "" });

  const load = useCallback(async () => {
    try { setRows(await api("/api/overrides")); } catch (e: any) { notify("err", e.message); }
  }, [api, notify]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      await api("/api/overrides", { method: "PUT", body: JSON.stringify({ ...d, price_override: String(d.price_override).replace(",", ".") }) });
      notify("good", "Kaydedildi."); setD({ barcode: "", price_override: "", hidden: false, note: "" }); load();
    } catch (e: any) { notify("err", e.message); }
  }
  async function remove(barcode: string) {
    try { await api(`/api/overrides?barcode=${encodeURIComponent(barcode)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  return (
    <>
      <div className="card">
        <h2>Ürün istisnası ekle</h2>
        <p className="muted">Belirli bir barkod için sabit fiyat yaz veya ürünü satıştan kaldır (stok 0 gönderilir).</p>
        <div className="grid">
          <label className="f">Barkod<input type="text" value={d.barcode} onChange={(e) => setD({ ...d, barcode: e.target.value })} /></label>
          <label className="f">Sabit satış fiyatı (TL)<input type="text" inputMode="decimal" value={d.price_override} onChange={(e) => setD({ ...d, price_override: e.target.value })} /><small>Boşsa formül kullanılır</small></label>
          <label className="f">Not<input type="text" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
        </div>
        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={d.hidden} onChange={(e) => setD({ ...d, hidden: e.target.checked })} />Bu ürünü satıştan kaldır (stok 0)
        </label>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={save}>Kaydet</button></div>
      </div>

      <div className="card">
        <h2>İstisnalar ({rows.length})</h2>
        {rows.length === 0 ? <p className="muted">İstisna yok. Tüm ürünler formülle fiyatlanır.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Barkod</th><th className="n">Sabit fiyat</th><th>Durum</th><th>Not</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.barcode}>
                <td>{r.barcode}</td>
                <td className="n">{r.price_override == null ? "-" : tl(Number(r.price_override))}</td>
                <td>{r.hidden ? "Satıştan kaldırıldı" : "Aktif"}</td>
                <td>{r.note ?? ""}</td>
                <td className="n"><button className="btn danger" onClick={() => remove(r.barcode)}>Sil</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
