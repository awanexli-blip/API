"use client";

import { useEffect, useRef, useState } from "react";
import type { Api } from "./shared";

const LABEL: Record<string, string> = { trendyol: "Trendyol" };
type Hit = { name: string; markets: Record<string, number> };

// Marka kutusu: yazdıkça pazaryeri marka listesinden öneri; yazılan marka pazaryerinde var mı gösterir.
// Hepsiburada / N11 / Amazon marka listesi bağlanınca LABEL'a eklenir.
export default function BrandInput({ api, value, onChange, placeholder, local = [] }: {
  api: Api; value: string; onChange: (v: string) => void; placeholder?: string; local?: string[];
}) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [exact, setExact] = useState<Record<string, boolean | null>>({});
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setHits([]); setExact({}); return; }
    const t = setTimeout(() => {
      api(`/api/brands/search?q=${encodeURIComponent(q)}`).then((r) => { setHits(Array.isArray(r?.results) ? r.results : []); setExact(r?.exact ?? {}); }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [api, value]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const q = value.trim().toLocaleLowerCase("tr");
  const localHits = local.filter((b) => q && b.toLocaleLowerCase("tr").includes(q) && !hits.some((h) => h.name.toLocaleLowerCase("tr") === b.toLocaleLowerCase("tr"))).slice(0, 5);
  const status = Object.entries(exact);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <input type="text" value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {open && (hits.length > 0 || localHits.length > 0) && (
        <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "100%", marginTop: 2, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, maxHeight: 280, overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,.15)" }}>
          {hits.map((h) => (
            <button key={h.name} type="button" onClick={() => { onChange(h.name); setOpen(false); }}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%", padding: "7px 10px", background: "none", border: 0, borderBottom: "1px solid var(--line)", color: "var(--ink)", font: "inherit", textAlign: "left", cursor: "pointer" }}>
              <span>{h.name}</span>
              <span style={{ fontSize: 12, color: "var(--ok)" }}>{Object.keys(h.markets).map((m) => `✓ ${LABEL[m] ?? m}`).join("  ")}</span>
            </button>
          ))}
          {localHits.map((b) => (
            <button key={"l" + b} type="button" onClick={() => { onChange(b); setOpen(false); }}
              style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "7px 10px", background: "none", border: 0, borderBottom: "1px solid var(--line)", color: "var(--ink)", font: "inherit", textAlign: "left", cursor: "pointer" }}>
              <span>{b}</span><span className="muted" style={{ fontSize: 12 }}>ürünlerinde kullanılmış</span>
            </button>
          ))}
        </div>
      )}
      {value.trim().length >= 2 && status.length > 0 && (
        <small style={{ display: "block", marginTop: 4 }}>
          {status.map(([m, ok]) => (
            <span key={m} style={{ marginRight: 10, color: ok == null ? "var(--muted)" : ok ? "var(--ok)" : "var(--bad)" }}>
              {ok == null ? `${LABEL[m] ?? m}: liste çekilmedi` : ok ? `✓ ${LABEL[m] ?? m}'da var` : `✗ ${LABEL[m] ?? m}'da bu isimde marka yok`}
            </span>
          ))}
        </small>
      )}
    </div>
  );
}
