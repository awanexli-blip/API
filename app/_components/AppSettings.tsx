"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import Icon from "./Icon";
import { when, type Api, type Notify, type Row } from "./shared";
import type { Theme } from "./theme";

const ROLE_TR: Record<string, string> = { admin: "Yönetici", editor: "Editör", viewer: "Görüntüleyici" };
const ROLE_HINT: Record<string, string> = {
  admin: "Her şey: pazaryerleri, fiyat, tedarikçi, kullanıcılar, kalıcı silme",
  editor: "Ürün ekler/düzenler, dosya içe aktarır",
  viewer: "Sadece görür",
};

export default function AppSettings({ api, notify, role, email, theme, setTheme }: { api: Api; notify: Notify; role: string; email: string; theme: Theme; setTheme: (t: Theme) => void }) {
  const isAdmin = role === "admin";
  return (
    <>
      <div className="card">
        <h2>Görünüm</h2>
        <div className="seg" role="group" aria-label="Tema">
          {([["system", "Sistem", "monitor"], ["light", "Gündüz", "sun"], ["dark", "Gece", "moon"]] as [Theme, string, string][]).map(([k, l, ic]) => (
            <button key={k} aria-pressed={theme === k} onClick={() => setTheme(k)}><span className="row" style={{ gap: 6 }}><Icon name={ic} size={15} />{l}</span></button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>"Sistem" seçiliyken telefonun/bilgisayarın gece moduna göre kendiliğinden değişir. Seçim bu cihazda saklanır.</p>
      </div>

      <div className="card">
        <h2>Hesap</h2>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><b>{email}</b><br /><span className="muted" style={{ fontSize: 13 }}>{ROLE_TR[role]} · {ROLE_HINT[role]}</span></div>
          <button className="btn" onClick={() => supabase.auth.signOut()}><Icon name="logout" size={16} />Çıkış</button>
        </div>
      </div>

      {isAdmin && <Users api={api} notify={notify} me={email} />}
      {isAdmin && <General api={api} notify={notify} />}
      {isAdmin && <Jobs api={api} notify={notify} />}
      {isAdmin && <Health api={api} />}
    </>
  );
}

function Users({ api, notify, me }: { api: Api; notify: Notify; me: string }) {
  const [list, setList] = useState<Row[]>([]);
  const [d, setD] = useState({ email: "", role: "editor", invite: true });
  const load = useCallback(() => api("/api/users").then(setList).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    try { const r = await api("/api/users", { method: "PUT", body: JSON.stringify(d) }); notify("good", `${d.email}: ${ROLE_TR[d.role]} yetkisi verildi.${r.invited ? ` ${r.invited}.` : ""}`); setD({ ...d, email: "" }); load(); }
    catch (e: any) { notify("err", e.message); }
  }
  async function change(u: Row, role: string) {
    try { await api("/api/users", { method: "PUT", body: JSON.stringify({ email: u.email, role }) }); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function remove(u: Row) {
    if (!confirm(`${u.email} kullanıcısının panel erişimi kaldırılsın mı?`)) return;
    try { await api(`/api/users?email=${encodeURIComponent(u.email)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }
  return (
    <div className="card">
      <h2>Kullanıcılar ve roller</h2>
      <div className="scroll"><table className="cards">
        <thead><tr><th>E-posta</th><th>Rol</th><th>Eklenme</th><th /></tr></thead>
        <tbody>{list.map((u) => (
          <tr key={u.email}>
            <td data-label="E-posta">{u.email}{u.owner && <span className="pill info" style={{ marginLeft: 6 }}>ana yönetici</span>}</td>
            <td data-label="Rol" style={{ width: 180 }}>{u.owner || u.email === me ? ROLE_TR[u.role] : (
              <select value={u.role} onChange={(e) => change(u, e.target.value)}>{Object.entries(ROLE_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            )}</td>
            <td data-label="Eklenme" className="muted" style={{ fontSize: 13 }}>{u.created_at ? when(u.created_at) : "-"}</td>
            <td className="n">{!u.owner && u.email !== me && <button className="btn danger" onClick={() => remove(u)}>Kaldır</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <h3>Kullanıcı ekle</h3>
      <div className="grid">
        <label className="f">E-posta<input type="email" value={d.email} placeholder="kisi@ornek.com" onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
        <label className="f">Rol<select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })}>{Object.entries(ROLE_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><small>{ROLE_HINT[d.role]}</small></label>
        <label className="check" style={{ alignSelf: "center" }}><input type="checkbox" checked={d.invite} onChange={(e) => setD({ ...d, invite: e.target.checked })} />Hesabı yoksa davet e-postası gönder</label>
      </div>
      <button className="btn primary" style={{ marginTop: 12 }} disabled={!d.email.includes("@")} onClick={add}>Ekle</button>
    </div>
  );
}

function General({ api, notify }: { api: Api; notify: Notify }) {
  const [f, setF] = useState<Row | null>(null);
  useEffect(() => { api("/api/settings?mp=trendyol").then((s) => setF({ fx_usd: String(s.fx_usd ?? ""), fx_eur: String(s.fx_eur ?? ""), vat_rate: String(s.vat_rate ?? 20) })).catch((e) => notify("err", e.message)); }, [api, notify]);
  async function save() {
    try {
      const body = { fx_usd: Number(String(f!.fx_usd).replace(",", ".")), fx_eur: Number(String(f!.fx_eur).replace(",", ".")), vat_rate: Number(f!.vat_rate) };
      await api("/api/settings?mp=trendyol", { method: "PUT", body: JSON.stringify(body) }); notify("good", "Genel ayarlar kaydedildi.");
    } catch (e: any) { notify("err", e.message); }
  }
  if (!f) return null;
  return (
    <div className="card">
      <h2>Genel</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Tedarikçi fiyatı döviz ise TL'ye çevirmede kullanılır (tüm pazaryerleri). Kâr ve komisyon ayarları her pazaryerinin kendi sayfasında.</p>
      <div className="grid">
        <label className="f">USD kuru (TL)<input type="text" inputMode="decimal" value={f.fx_usd} onChange={(e) => setF({ ...f, fx_usd: e.target.value })} /></label>
        <label className="f">EUR kuru (TL)<input type="text" inputMode="decimal" value={f.fx_eur} onChange={(e) => setF({ ...f, fx_eur: e.target.value })} /></label>
        <label className="f">Varsayılan KDV<select value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></label>
      </div>
      <button className="btn primary" style={{ marginTop: 12 }} onClick={save}>Kaydet</button>
    </div>
  );
}

const JOB_TR: Record<string, string> = { queued: "sırada", running: "çalışıyor", done: "tamam", failed: "başarısız", cancelled: "iptal" };
const JOB_TYPE_TR: Record<string, string> = { link_listings: "İlanları ürünlere bağla", "send_products:trendyol": "Trendyol'a ürün gönder" };
function Jobs({ api, notify }: { api: Api; notify: Notify }) {
  const [list, setList] = useState<Row[] | null>(null);
  const load = useCallback(() => api("/api/jobs").then(setList).catch(() => setList([])), [api]);
  useEffect(() => { load(); }, [load]);
  async function act(id: number, action: "retry" | "cancel") {
    try { await api("/api/jobs", { method: "PUT", body: JSON.stringify({ id, action }) }); notify("good", action === "retry" ? "İş yeniden kuyruğa alındı." : "İş iptal edildi."); load(); } catch (e: any) { notify("err", e.message); }
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>İş kuyruğu</h2><button className="btn" onClick={load}><Icon name="refresh" size={16} />Yenile</button></div>
      <p className="muted" style={{ fontSize: 13 }}>Arka plan işleri her senkrondan sonra çalışır; hata olursa artan beklemeyle en fazla 5 kez denenir.</p>
      {!list ? <p className="muted">Yükleniyor...</p> : list.length === 0 ? <p className="muted" style={{ margin: 0 }}>Henüz iş yok.</p> : (
        <div className="scroll"><table className="cards">
          <thead><tr><th>İş</th><th>Durum</th><th className="n">Deneme</th><th>Zaman</th><th /></tr></thead>
          <tbody>{list.map((j) => (
            <tr key={j.id}>
              <td data-label="İş">#{j.id} {JOB_TYPE_TR[j.type] ?? j.type}{j.last_error ? <><br /><span style={{ color: "var(--bad)", fontSize: 12 }}>{String(j.last_error).slice(0, 160)}</span></> : null}</td>
              <td data-label="Durum"><span className={`pill ${j.status === "done" ? "ok" : j.status === "failed" ? "error" : j.status === "cancelled" ? "" : "partial"}`}>{JOB_TR[j.status] ?? j.status}</span></td>
              <td data-label="Deneme" className="n">{j.attempts}/{j.max_attempts}</td>
              <td data-label="Zaman" className="muted" style={{ fontSize: 13 }}>{when(j.updated_at)}</td>
              <td className="n">{(j.status === "failed" || j.status === "cancelled") && <button className="btn" onClick={() => act(j.id, "retry")}>Yeniden dene</button>}{j.status === "queued" && <button className="btn" onClick={() => act(j.id, "cancel")}>İptal</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Health({ api }: { api: Api }) {
  const [h, setH] = useState<Row | null>(null);
  const check = useCallback(() => { setH({ loading: true }); api("/api/health").then(setH).catch((e) => setH({ ok: false, checks: [{ name: "Panel API", ok: false, detail: e.message }] })); }, [api]);
  useEffect(() => { check(); }, [check]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Sistem durumu {h && !h.loading && <span className={`pill ${h.ok ? "ok" : "error"}`}>{h.ok ? "her şey yolunda" : "sorun var"}</span>}</h2>
        <button className="btn" onClick={check}><Icon name="refresh" size={16} />Kontrol et</button>
      </div>
      {!h || h.loading ? <p className="muted">Kontrol ediliyor...</p> : (
        <table style={{ marginTop: 10 }}><tbody>{(h.checks ?? []).map((c: Row) => (
          <tr key={c.name}><td style={{ width: 28, color: c.ok ? "var(--ok)" : "var(--bad)" }}><Icon name={c.ok ? "check" : "x"} size={16} /></td><td>{c.name}</td><td className="muted" style={{ fontSize: 13 }}>{c.ok ? c.detail ?? "tamam" : c.detail ?? "eksik"}</td></tr>
        ))}</tbody></table>
      )}
      {h?.version && <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>Sürüm: {h.version}</p>}
    </div>
  );
}
