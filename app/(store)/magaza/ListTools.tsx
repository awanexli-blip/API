"use client";
// Liste araç çubuğu (Bezos'tan ilham): "bu listede ara" + sıralama seçimi. Form GET ile çalışır (JS kapalıyken "Ara" Enter ile gönderilir);
// sıralama seçilince form kendiliğinden gönderilir. Kategori/alt kategori/fiyat filtreleri gizli alanlarla korunur.
import { useRef } from "react";
import Icon from "./Icon";

const SORTS: [string, string][] = [["onerilen", "Önerilen"], ["fiyat-artan", "Fiyat: düşükten yükseğe"], ["fiyat-azalan", "Fiyat: yüksekten düşüğe"], ["yeni", "En yeniler"]];

export default function ListTools({ action, keep, q, sort, placeholder }: { action: string; keep: Record<string, string | undefined>; q?: string; sort: string; placeholder: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} className="toolbar" action={action} role="search">
      {Object.entries(keep).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="search">
        <label className="sr" htmlFor="lq">Bu listede ara</label>
        <Icon name="search" />
        <input id="lq" name="q" type="search" defaultValue={q ?? ""} placeholder={placeholder} minLength={2} maxLength={80} enterKeyHint="search" />
        <button type="submit">Ara</button>
      </div>
      <label className="sr" htmlFor="ls">Sıralama</label>
      <select id="ls" className="sortsel" name="sirala" defaultValue={sort} onChange={() => form.current?.requestSubmit()}>
        {SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </form>
  );
}
