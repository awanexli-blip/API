"use client";
// Başlık araması (K 19.11): yazarken öneri (ilk 6 ürün görsel+fiyat, eşleşen kategoriler sayılı), son aramalar, klavye ile gezinme.
// ARIA combobox deseni; JS kapalıyken düz GET formu olarak çalışır. Son aramalar yalnızca bu tarayıcıda (localStorage, hata yutulmaz ama zorunlu değil).
import { useEffect, useId, useRef, useState } from "react";
import { imgUrl, tl } from "@/lib/store";
import Icon from "./Icon";

type Sugg = { items: { slug: string; title: string; price: number; image: string | null }[]; cats: { name: string; n: number }[]; total: number; fuzzy?: boolean };
type Opt = { key: string; href: string; node: React.ReactNode };
const RECENT = "oz-son-aramalar";
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : []; } catch { return []; } };
const saveRecent = (q: string) => { try { localStorage.setItem(RECENT, JSON.stringify([q, ...readRecent().filter((x) => x.toLocaleLowerCase("tr") !== q.toLocaleLowerCase("tr"))].slice(0, 6))); } catch { /* gizli pencere: son aramalar tutulmaz */ } };

export default function SearchBox({ base }: { base: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Sugg | null>(null);
  const [err, setErr] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLFormElement>(null);
  const term = q.trim();
  const searchHref = (t: string, extra = "") => `${base}/ara?q=${encodeURIComponent(t)}${extra}`;

  useEffect(() => { // ürün/arama sayfasında kutuyu mevcut aramayla doldur
    const cur = new URLSearchParams(location.search).get("q");
    if (cur && location.pathname.endsWith("/ara")) setQ(cur);
  }, []);
  useEffect(() => {
    if (term.length < 2) { setData(null); setErr(false); return; }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${base}/api/oneri?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json()); setErr(false); setActive(-1);
      } catch (e) { if ((e as Error).name !== "AbortError") { setData(null); setErr(true); } }
    }, 180);
    return () => { clearTimeout(t); ac.abort(); };
  }, [term, base]);
  useEffect(() => {
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, []);

  const opts: Opt[] = [];
  if (term.length < 2) {
    for (const r of recent) opts.push({ key: `r:${r}`, href: searchHref(r), node: <><Icon name="search" size={16} /><span className="t">{r}</span></> });
  } else if (data) {
    for (const c of data.cats) opts.push({ key: `c:${c.name}`, href: searchHref(term, `&kat=${encodeURIComponent(c.name)}`), node: <><Icon name="grid" size={16} /><span className="t"><b>{term}</b> · {c.name}</span><small>{c.n.toLocaleString("tr-TR")}</small></> });
    for (const i of data.items) opts.push({ key: `p:${i.slug}`, href: `${base}/urun/${i.slug}`, node: <>{i.image ? <img src={imgUrl(i.image)!} alt="" width={44} height={44} loading="lazy" /> : <span className="ph" />}<span className="t">{i.title}</span><b className="p">{tl(i.price)}</b></> });
    if (data.total > data.items.length) opts.push({ key: "all", href: searchHref(term), node: <span className="t all">Tüm {data.total.toLocaleString("tr-TR")} sonucu gör <Icon name="next" size={14} /></span> });
  }
  const show = open && (opts.length > 0 || (term.length >= 2 && (err || (data && !data.items.length))));

  const go = (href: string) => { if (term.length >= 2) saveRecent(term); location.href = href; };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!opts.length) return;
      e.preventDefault(); setOpen(true);
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % opts.length : (a <= 0 ? opts.length - 1 : a - 1)));
    } else if (e.key === "Enter" && open && active >= 0 && opts[active]) { e.preventDefault(); go(opts[active].href); }
    else if (e.key === "Escape") { setOpen(false); setActive(-1); }
  };

  return (
    <form ref={box} className="search" action={`${base}/ara`} role="search" onSubmit={() => { if (term.length >= 2) saveRecent(term); }}>
      <label className="sr" htmlFor="q">Ürün ara</label>
      <Icon name="search" />
      <input id="q" name="q" type="search" placeholder="Ürün, marka ya da kategori ara" minLength={2} maxLength={80} autoComplete="off" enterKeyHint="search"
        role="combobox" aria-expanded={!!show} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={show && active >= 0 ? `${id}-o${active}` : undefined}
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => { setRecent(readRecent()); setOpen(true); }} onKeyDown={onKey} />
      <button type="submit">Ara</button>
      {show && (
        <div className="suggest" id={`${id}-list`} role="listbox" aria-label="Arama önerileri">
          {term.length < 2 && recent.length > 0 && <div className="sh">Son aramalarınız</div>}
          {data?.fuzzy && data.items.length > 0 && <div className="sh">Tam eşleşme yok, benzer ürünler:</div>}
          {opts.map((o, i) => (
            <a key={o.key} id={`${id}-o${i}`} role="option" aria-selected={i === active} href={o.href} className={`so${o.key.startsWith("p:") ? " prod" : ""}`}
              onMouseEnter={() => setActive(i)} onClick={(e) => { e.preventDefault(); go(o.href); }}>{o.node}</a>
          ))}
          {term.length >= 2 && data && !data.items.length && <div className="sh">“{term}” için öneri yok. Daha kısa bir kelime deneyin.</div>}
          {err && <div className="sh">Öneriler şu an alınamadı, “Ara” ile arayabilirsiniz.</div>}
        </div>
      )}
    </form>
  );
}
