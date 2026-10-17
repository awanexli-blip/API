"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import { useApi, type Notify } from "./_components/shared";
import Overview from "./_components/Overview";
import Settings from "./_components/Settings";
import Categories from "./_components/Categories";
import Brands from "./_components/Brands";
import ProfitRules from "./_components/ProfitRules";
import Overrides from "./_components/Overrides";
import Upcoming, { UPCOMING } from "./_components/Upcoming";
import Products from "./_components/Products";

const MARKETS: { id: string; label: string; live: boolean }[] = [
  { id: "trendyol", label: "Trendyol", live: true },
  { id: "hepsiburada", label: "Hepsiburada", live: true },
  ...UPCOMING.filter((u) => u.id !== "hepsiburada").map((u) => ({ id: u.id, label: u.label, live: false })),
];

type Sub = "ozet" | "ayarlar" | "kar" | "markalar" | "kategoriler" | "ozel";
const SUBS: [Sub, string][] = [
  ["ozet", "Özet"],
  ["ayarlar", "Fiyat ayarları"],
  ["kar", "Akıllı kâr"],
  ["markalar", "Markalar"],
  ["kategoriler", "Kategoriler"],
  ["ozel", "Ürün istisnaları"],
];

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
    <div className="login card">
      <h1>Pazaryeri Paneli</h1>
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

function Panel({ token, email }: { token: string; email: string }) {
  const [market, setMarket] = useState("trendyol");
  const [sub, setSub] = useState<Sub>("ozet");
  const [msg, setMsg] = useState<{ t: "err" | "good"; m: string } | null>(null);
  const api = useApi(token);

  // useCallback: aksi halde her mesajda yeni fonksiyon -> alt sekmelerin load() efekti tekrar çalışır -> hata varsa sonsuz döngü
  const notify: Notify = useCallback((t, m) => { setMsg({ t, m }); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const info = MARKETS.find((m) => m.id === market)?.live ? undefined : UPCOMING.find((u) => u.id === market);
  const props = { api, notify, marketplace: market };

  return (
    <div className="wrap">
      <div className="top">
        <h1>Pazaryeri Paneli</h1>
        <div className="row">
          <span className="muted" style={{ fontSize: 13 }}>{email}</span>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Çıkış</button>
        </div>
      </div>

      <nav className="markets" role="tablist" aria-label="Bölüm">
        <button role="tab" aria-selected={market === "urunler"} className="market" onClick={() => { setMarket("urunler"); setMsg(null); }}>Ürünler</button>
        <span className="sep" aria-hidden="true" />
        {MARKETS.map((m) => (
          <button key={m.id} role="tab" aria-selected={market === m.id} className="market" onClick={() => { setMarket(m.id); setSub("ozet"); setMsg(null); }}>
            {m.label}{!m.live && <span className="soon">yakında</span>}
          </button>
        ))}
      </nav>

      {msg && <div className={`msg ${msg.t}`} role="status">{msg.m}<button className="x" aria-label="Kapat" onClick={() => setMsg(null)}>×</button></div>}

      {market === "urunler" ? <Products api={api} notify={notify} /> : info ? <Upcoming info={info} /> : (
        <>
          <div className="tabs" role="tablist">
            {SUBS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sub === k} className="tab" onClick={() => { setSub(k); setMsg(null); }}>{label}</button>
            ))}
          </div>
          <div key={market}>
            {sub === "ozet" && <Overview {...props} />}
            {sub === "ayarlar" && <Settings {...props} />}
            {sub === "kar" && <ProfitRules {...props} />}
            {sub === "markalar" && <Brands {...props} />}
            {sub === "kategoriler" && <Categories {...props} />}
            {sub === "ozel" && <Overrides {...props} />}
          </div>
        </>
      )}
    </div>
  );
}
