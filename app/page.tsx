"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import { useApi, type Notify } from "./_components/shared";
import Icon from "./_components/Icon";
import Dashboard from "./_components/Dashboard";
import Overview from "./_components/Overview";
import Settings from "./_components/Settings";
import Categories from "./_components/Categories";
import Brands from "./_components/Brands";
import ProfitRules from "./_components/ProfitRules";
import Overrides from "./_components/Overrides";
import Upcoming, { UPCOMING } from "./_components/Upcoming";
import Products from "./_components/Products";
import Suppliers from "./_components/Suppliers";
import Import from "./_components/Import";
import Feeds from "./_components/Feeds";
import AppSettings from "./_components/AppSettings";
import AmazonMatching from "./_components/AmazonMatching";
import Rejections from "./_components/Rejections";
import Unsent from "./_components/Unsent";
import ListingStatus from "./_components/ListingStatus";
import Orders from "./_components/Orders";
import { applyTheme, currentTheme, type Theme } from "./_components/theme";

type Role = "viewer" | "editor" | "admin";
const MARKETS: { id: string; label: string; live: boolean }[] = [
  { id: "trendyol", label: "Trendyol", live: true },
  { id: "hepsiburada", label: "Hepsiburada", live: true },
  { id: "amazon", label: "Amazon TR", live: true },
  ...UPCOMING.filter((u) => u.id !== "hepsiburada" && u.id !== "amazon").map((u) => ({ id: u.id, label: u.label, live: false })),
];
const SUBS: [string, string][] = [
  ["ozet", "Özet"], ["fiyat", "Fiyat ayarları"], ["kar", "Akıllı kâr"], ["durum", "Gönderim durumu"], ["eslestirme", "Eşleştirme"], ["gonderilemeyen", "Gönderilemeyenler"], ["reddedilen", "Reddedilenler"], ["markalar", "Markalar"], ["kategoriler", "Kategoriler"], ["istisnalar", "Ürün istisnaları"],
];

// Adres çubuğu ile gezinme: #/urunler, #/pazaryeri/trendyol/kar ... (yenileyince aynı ekran, geri tuşu çalışır)
function useRoute(): [string[], (path: string) => void] {
  const read = () => (typeof window === "undefined" ? [] : window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean));
  const [parts, setParts] = useState<string[]>([]);
  useEffect(() => {
    const on = () => setParts(read());
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((path: string) => { window.location.hash = `/${path}`; }, []);
  return [parts, go];
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!ready) return null;
  return session ? <Panel token={session.access_token} email={session.user.email ?? ""} /> : <Login />;
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
    <div className="login-wrap">
      <div className="login card">
        <div className="brand" style={{ padding: "0 0 12px" }}><span className="logo"><Icon name="layers" size={18} /></span>Pazaryeri Paneli</div>
        <p className="muted">Devam etmek için giriş yap.</p>
        {err && <div className="msg err">{err}</div>}
        <form onSubmit={submit} className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <label className="f">E-posta<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="f">Şifre<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
          <button className="btn primary" disabled={busy}>{busy ? "Giriş yapılıyor..." : "Giriş yap"}</button>
        </form>
      </div>
    </div>
  );
}

type Toast = { id: number; t: "err" | "good"; m: string };

function Panel({ token, email }: { token: string; email: string }) {
  const api = useApi(token);
  const [route, go] = useRoute();
  const [role, setRole] = useState<Role | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<Theme>("system");
  const seq = useRef(0);
  useEffect(() => { setTheme(currentTheme()); }, []);
  useEffect(() => { api("/api/me").then((m) => setRole(m.role)).catch(() => setRole("viewer")); }, [api]);

  // Bildirim: başarılı olanlar 6 sn sonra kapanır, hatalar kapatılana kadar kalır
  const notify: Notify = useCallback((t, m) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-3), { id, t, m }]);
    if (t === "good") setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 6000);
  }, []);
  const close = (id: number) => setToasts((x) => x.filter((y) => y.id !== id));

  const isAdmin = role === "admin";
  const canEdit = role === "admin" || role === "editor";
  const [section = "panel", a, b] = route;
  const mp = section === "pazaryeri" ? a ?? "trendyol" : "";
  const sub = section === "pazaryeri" ? b ?? "ozet" : "";
  const nav = (path: string) => { go(path); setDrawer(false); window.scrollTo({ top: 0 }); };
  const cycleTheme = () => { const n: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system"; applyTheme(n); setTheme(n); };
  const themeIcon = theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor";
  const themeLabel = theme === "dark" ? "Koyu" : theme === "light" ? "Açık" : "Sistem";

  const items: { path: string; label: string; icon: string; show: boolean; group?: string; tag?: string; active: boolean }[] = [
    { path: "panel", label: "Gösterge paneli", icon: "home", show: true, active: section === "panel" },
    { path: "siparisler", label: "Siparişler", icon: "cart", show: canEdit, active: section === "siparisler" },
    { path: "urunler", label: "Ürünler", icon: "box", show: true, group: "Katalog", active: section === "urunler" },
    { path: "tedarikciler", label: "Tedarikçiler", icon: "truck", show: isAdmin, active: section === "tedarikciler" },
    { path: "ice-aktar", label: "İçe aktar", icon: "upload", show: canEdit, active: section === "ice-aktar" },
    { path: "feed", label: "XML feed", icon: "rss", show: isAdmin, active: section === "feed" },
    ...MARKETS.map((m, i) => ({ path: `pazaryeri/${m.id}/ozet`, label: m.label, icon: "store", show: isAdmin, group: i === 0 ? "Pazaryerleri" : undefined, tag: m.live ? undefined : "yakında", active: mp === m.id })),
    { path: "ayarlar", label: "Ayarlar", icon: "settings", show: true, group: "Sistem", active: section === "ayarlar" },
  ];
  const navList = (
    <>
      {items.filter((i) => i.show).map((i) => (
        <div key={i.path}>
          {i.group && <div className="nav-group">{i.group}</div>}
          <button className="nav-item" aria-current={i.active ? "page" : undefined} onClick={() => nav(i.path)}>
            <Icon name={i.icon} />{i.label}{i.tag && <span className="tag">{i.tag}</span>}
          </button>
        </div>
      ))}
    </>
  );
  const foot = (
    <div className="side-foot">
      <button className="nav-item" onClick={cycleTheme} title="Gece / gündüz"><Icon name={themeIcon} />Tema: {themeLabel}</button>
      <div className="who">{email}{role ? ` · ${role === "admin" ? "yönetici" : role === "editor" ? "editör" : "görüntüleyici"}` : ""}</div>
      <button className="nav-item" onClick={() => supabase.auth.signOut()}><Icon name="logout" />Çıkış</button>
    </div>
  );
  const marketInfo = MARKETS.find((m) => m.id === mp);
  const title = section === "pazaryeri" ? marketInfo?.label ?? "Pazaryeri" : items.find((i) => i.active)?.label ?? "Panel";
  const props = { api, notify, marketplace: mp };

  let page: React.ReactNode;
  if (!role) page = <div className="card"><div className="skeleton" style={{ width: "40%", marginBottom: 10 }} /><div className="skeleton" style={{ width: "70%" }} /></div>;
  else if (section === "panel") page = <Dashboard api={api} notify={notify} role={role} go={nav} />;
  else if (section === "siparisler" && canEdit) page = <Orders api={api} notify={notify} />;
  else if (section === "urunler") page = <Products api={api} notify={notify} />;
  else if (section === "tedarikciler" && isAdmin) page = <Suppliers api={api} notify={notify} />;
  else if (section === "ice-aktar" && canEdit) page = <Import api={api} notify={notify} isAdmin={isAdmin} onDone={() => {}} />;
  else if (section === "feed" && isAdmin) page = <Feeds api={api} notify={notify} />;
  else if (section === "ayarlar") page = <AppSettings api={api} notify={notify} role={role} email={email} theme={theme} setTheme={(t) => { applyTheme(t); setTheme(t); }} />;
  else if (section === "pazaryeri" && isAdmin && marketInfo) {
    const info = marketInfo.live ? undefined : UPCOMING.find((u) => u.id === mp);
    page = info ? <Upcoming info={info} /> : (
      <>
        <div className="tabs" role="tablist">
          {SUBS.filter(([k]) => (mp === "amazon" ? !["markalar", "kategoriler", "reddedilen", "gonderilemeyen", "durum"].includes(k) : k !== "eslestirme" && (mp === "trendyol" || (k !== "reddedilen" && k !== "gonderilemeyen")))).map(([k, label]) => <button key={k} role="tab" aria-selected={sub === k} className="tab" onClick={() => nav(`pazaryeri/${mp}/${k}`)}>{label}</button>)}
        </div>
        <div key={mp + sub}>
          {sub === "ozet" && <Overview {...props} />}
          {sub === "fiyat" && <Settings {...props} />}
          {sub === "kar" && <ProfitRules {...props} />}
          {sub === "eslestirme" && mp === "amazon" && <AmazonMatching {...props} />}
          {sub === "durum" && mp !== "amazon" && <ListingStatus {...props} />}
          {sub === "reddedilen" && mp === "trendyol" && <Rejections {...props} />}
          {sub === "gonderilemeyen" && mp === "trendyol" && <Unsent {...props} />}
          {sub === "markalar" && <Brands {...props} />}
          {sub === "kategoriler" && <Categories {...props} />}
          {sub === "istisnalar" && <Overrides {...props} />}
        </div>
      </>
    );
  } else page = <div className="card empty"><Icon name="shield" size={32} /><p>Bu bölüm için yetkin yok veya sayfa bulunamadı.</p><button className="btn" onClick={() => nav("panel")}>Gösterge paneline dön</button></div>;

  const bottom: [string, string, string, boolean][] = [
    ["panel", "Panel", "home", section === "panel"],
    ["urunler", "Ürünler", "box", section === "urunler"],
    [isAdmin ? "tedarikciler" : "ice-aktar", isAdmin ? "Tedarikçi" : "İçe aktar", isAdmin ? "truck" : "upload", section === "tedarikciler" || (!isAdmin && section === "ice-aktar")],
    [isAdmin ? "pazaryeri/trendyol/ozet" : "ayarlar", isAdmin ? "Pazaryeri" : "Ayarlar", isAdmin ? "store" : "settings", isAdmin ? section === "pazaryeri" : section === "ayarlar"],
  ];

  return (
    <div className="app">
      <aside className="side" aria-label="Ana menü">
        <div className="brand"><span className="logo"><Icon name="layers" size={18} /></span>Pazaryeri Paneli</div>
        {navList}
        {foot}
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn icon ghost" aria-label="Menü" onClick={() => setDrawer(true)}><Icon name="menu" size={22} /></button>
          <span className="title">{title}</span>
          <button className="btn icon ghost" aria-label={`Tema: ${themeLabel}`} onClick={cycleTheme}><Icon name={themeIcon} /></button>
        </header>
        <main className="content">
          {section !== "panel" && (
            <div className="page-head">
              <div><h1>{title}</h1>{section === "pazaryeri" && <div className="sub">{SUBS.find(([k]) => k === sub)?.[1]}</div>}</div>
            </div>
          )}
          {page}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Alt menü">
        {bottom.map(([p, l, ic, act]) => <button key={p} aria-current={act ? "page" : undefined} onClick={() => nav(p)}><Icon name={ic} size={20} />{l}</button>)}
        <button onClick={() => setDrawer(true)}><Icon name="more" size={20} />Menü</button>
      </nav>

      {drawer && <>
        <div className="drawer-back" onClick={() => setDrawer(false)} />
        <div className="drawer" role="dialog" aria-label="Menü">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="brand" style={{ padding: "4px 8px" }}><span className="logo"><Icon name="layers" size={18} /></span>Menü</div>
            <button className="btn icon ghost" aria-label="Kapat" onClick={() => setDrawer(false)}><Icon name="x" /></button>
          </div>
          {navList}
          {foot}
        </div>
      </>}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.t}`} role={t.t === "err" ? "alert" : "status"}>
            <span style={{ color: t.t === "err" ? "var(--bad)" : "var(--ok)" }}><Icon name={t.t === "err" ? "alert" : "check"} /></span>
            <span className="t">{t.m}</span>
            <button aria-label="Kapat" onClick={() => close(t.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
