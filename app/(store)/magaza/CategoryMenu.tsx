"use client";
// Tüm kategoriler menüsü: yerel <dialog> (odak tuzağı, Esc, arka plan tıklaması). Masaüstünde iki sütun, telefonda ana -> alt kategori adımları.
// Masaüstü başlıktaki düğme ve telefon alt çubuğundaki düğme aynı menüyü açar (data-open-catmenu).
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

type Cat = { top: string; slug: string; n: number; image: string | null; subs: { sub: string; slug: string; n: number; image: string | null }[] };

export default function CategoryMenu({ cats, base }: { cats: Cat[]; base: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sel, setSel] = useState(0);
  const [step, setStep] = useState<"top" | "sub">("top");
  useEffect(() => {
    const open = (e: Event) => { if ((e.target as HTMLElement)?.closest?.("[data-open-catmenu]")) { e.preventDefault(); setStep("top"); ref.current?.showModal(); } };
    document.addEventListener("click", open);
    return () => document.removeEventListener("click", open);
  }, []);
  const close = () => ref.current?.close();
  const c = cats[sel];
  return (
    <dialog ref={ref} className="catmenu" aria-label="Tüm kategoriler" onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="wrapper">
        <div className="bar">
          {step === "sub" ? <button type="button" className="menu-btn back" onClick={() => setStep("top")}><Icon name="back" /> Kategoriler</button> : <b className="serif" style={{ fontSize: 22 }}>Kategoriler</b>}
          <button type="button" className="x" onClick={close} aria-label="Menüyü kapat"><Icon name="close" /></button>
        </div>
        <div className="inner" data-open={step}>
          <nav className="tops" aria-label="Ana kategoriler">
            {cats.map((t, i) => (
              <button key={t.slug} type="button" aria-current={i === sel ? "true" : undefined} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => { setSel(i); setStep("sub"); }}>
                {t.image ? <img src={t.image} alt="" width={40} height={40} loading="lazy" /> : null}
                <span style={{ flex: 1 }}>{t.top}</span><Icon name="arrow" size={16} />
              </button>
            ))}
          </nav>
          {c && (
            <section className="subs" aria-label={`${c.top} alt kategorileri`}>
              <div className="subs-head"><h2 className="serif" style={{ fontSize: 26 }}>{c.top}</h2><a className="link-arrow" href={`${base}/kategori/${c.slug}`}>Tümünü gör <Icon name="arrow" size={16} /></a></div>
              <ul>
                {c.subs.map((s) => (
                  <li key={s.slug}><a href={`${base}/kategori/${c.slug}?alt=${s.slug}`}>{s.image ? <img src={s.image} alt="" width={40} height={40} loading="lazy" /> : null}<span>{s.sub}<small>{s.n.toLocaleString("tr-TR")} ürün</small></span></a></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
