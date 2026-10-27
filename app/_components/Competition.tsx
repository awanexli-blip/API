"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { tl, when, type Props, type Row } from "./shared";

const FILTERS: [string, string, string][] = [
  ["suggest", "Öneriler", "Güncel verilere göre önerilen fiyat değişiklikleri (onayını bekler)"],
  ["winnable", "İn: buybox al", "Buybox başkasında; 1 TL altına inince en az 40 TL net kalıyor"],
  ["raise", "Artır", "Buybox bizde ama ikinci satıcı çok pahalı: fiyatı artırıp buybox'ı koruyarak daha çok kazan"],
  ["reset", "Formüle dön", "Elle fiyat var ama artık rakip yok"],
  ["lost", "Buybox başkasında", ""],
  ["won", "Buybox bizde", ""],
  ["alone", "Rakipsiz", ""],
  ["overridden", "Elle fiyatlı", ""],
  ["all", "Tümü", ""],
];
const KIND: Record<string, { label: string; color: string }> = {
  lower: { label: "İn", color: "var(--accent)" },
  raise: { label: "Artır", color: "var(--ok)" },
  reset: { label: "Formüle dön", color: "var(--warn)" },
};
const n = (v: unknown) => (v == null ? null : Number(v));

// Rekabet (Trendyol buybox): her senkronda 2.000 ilan güncel fiyatlarla kontrol edilir, öneri yenilenir (worker/core/buybox.ts suggestFor).
// Fiyat kendiliğinden değişmez: seçip onayladığın öneriler, onay anında hâlâ güncelse kaydedilir ve sonraki senkronda gönderilir.
export default function Competition({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [f, setF] = useState({ filter: "suggest", q: "", page: 0 });
  const [qText, setQText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Record<string, Row>>({});
  const load = useCallback(() => api(`/api/buybox?mp=${marketplace}&filter=${f.filter}&q=${encodeURIComponent(f.q)}&page=${f.page}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, marketplace, f]);
  useEffect(() => { load(); setSel({}); }, [load]);

  async function approve(list: Row[]) {
    if (!list.length) return;
    const lines = list.slice(0, 8).map((it) => `• ${String(it.title ?? it.listing_key).slice(0, 50)}: ${it.suggestion === "reset" ? "formül fiyatına dön" : `${tl(n(it.our_price) ?? 0)} → ${tl(n(it.target_price)!)} (net ${tl(n(it.net_now) ?? 0)} → ${tl(n(it.net_at_target) ?? 0)})`}`).join("\n");
    if (!confirm(`${list.length} öneri uygulanacak (sonraki senkronda Trendyol'a gider):\n\n${lines}${list.length > 8 ? `\n... ve ${list.length - 8} tane daha` : ""}\n\nOnaylıyor musun?`)) return;
    setBusy(true);
    try {
      const r = await api(`/api/buybox?mp=${marketplace}`, { method: "POST", body: JSON.stringify({ items: list.map((it) => ({ listing_key: it.listing_key, kind: it.suggestion, price: n(it.target_price) })) }) });
      notify("good", `${r.priced} fiyat kaydedildi, ${r.reset} ilan formüle döndü.${r.stale?.length ? ` ${r.stale.length} öneri bu arada değişti (rakip fiyatı oynadı); liste yenilendi, tekrar karşılaştır.` : ""} Sonraki senkronda gönderilir.`);
      setSel({}); load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }
  async function reset(it: Row) {
    setBusy(true);
    try { await api(`/api/buybox?mp=${marketplace}`, { method: "DELETE", body: JSON.stringify({ listing_key: it.listing_key }) }); notify("good", "Elle fiyat kaldırıldı; formül fiyatına dönülecek."); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const s = d.summary ?? {};
  const items: Row[] = d.items ?? [];
  const pages = Math.ceil(Number(d.total ?? 0) / 50);
  const selectable = items.filter((it) => it.suggestion);
  const picked = Object.values(sel);
  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Aynı ürünü satan başka satıcılar varsa Trendyol en uygun teklifi öne çıkarır (buybox). Her senkronda 2.000 ilan <b>güncel fiyatlarla</b> kontrol edilir ve öneriler yenilenir:
          <b> İn</b> (1 TL altına in, en az 40 TL net kalıyorsa), <b>Artır</b> (buybox bizde, ikinci satıcı çok pahalı), <b>Formüle dön</b> (rakip kalmadı). Fiyat kendiliğinden değişmez; onayladığın öneri, onay anında hâlâ güncelse uygulanır. Son kontrol: {when(s.last)}.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Öneri</div><div className="value" style={{ color: s.suggest ? "var(--accent)" : undefined }}>{Number(s.suggest ?? 0).toLocaleString("tr-TR")}</div><div className="hint">{Number(s.winnable ?? 0)} in · {Number(s.raise ?? 0)} artır · {Number(s.reset ?? 0)} formüle dön</div></div>
          <div className="kpi"><div className="label">Buybox bizde</div><div className="value" style={{ color: "var(--ok)" }}>{Number(s.won ?? 0).toLocaleString("tr-TR")}</div><div className="hint">{Number(s.competition ?? 0).toLocaleString("tr-TR")} rakipli ilandan</div></div>
          <div className="kpi"><div className="label">Buybox başkasında</div><div className="value" style={{ color: s.lost ? "var(--warn)" : undefined }}>{Number(s.lost ?? 0).toLocaleString("tr-TR")}</div></div>
          <div className="kpi"><div className="label">Elle fiyatlı</div><div className="value">{Number(s.overridden ?? 0).toLocaleString("tr-TR")}</div><div className="hint">{Number(s.checked ?? 0).toLocaleString("tr-TR")} ilan kontrol edildi</div></div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div className="seg">{FILTERS.map(([k, l, t]) => <button key={k} title={t} aria-pressed={f.filter === k} onClick={() => setF({ ...f, filter: k, page: 0 })}>{l}</button>)}</div>
          <div className="row" style={{ gap: 6 }}>
            <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); setF({ ...f, q: qText.trim(), page: 0 }); }}>
              <input type="search" placeholder="Ürün / barkod" value={qText} onChange={(e) => setQText(e.target.value)} />
              <button className="btn ghost" type="submit"><Icon name="search" size={16} />Ara</button>
            </form>
            <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
          </div>
        </div>
        {selectable.length > 0 && (
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={busy || !picked.length} onClick={() => approve(picked)}>Seçilen {picked.length} öneriyi onayla</button>
            <button className="btn ghost" disabled={busy} onClick={() => setSel(Object.fromEntries(selectable.map((it) => [it.listing_key, it])))}>Sayfadakileri seç</button>
            {picked.length > 0 && <button className="btn ghost" onClick={() => setSel({})}>Seçimi temizle</button>}
          </div>
        )}
        {!items.length ? <div className="empty"><Icon name="check" size={28} /><p>{s.checked ? "Bu filtrede ilan yok." : "Henüz kontrol yapılmadı; ilk sonuçlar bir sonraki senkronda gelir."}</p></div> : (
          <table className="cards" style={{ marginTop: 8 }}>
            <thead><tr><th /><th>Ürün</th><th className="n">Sıra</th><th className="n">Bizim fiyat</th><th className="n">Buybox / 2.</th><th className="n">Net şimdi</th><th className="n">Öneri</th><th className="n">Net öneride</th><th /></tr></thead>
            <tbody>{items.map((it) => {
              const k = KIND[it.suggestion ?? ""], target = n(it.target_price), nt = n(it.net_at_target), nn = n(it.net_now);
              return (
                <tr key={it.listing_key}>
                  <td data-label="">{it.suggestion && <input type="checkbox" checked={!!sel[it.listing_key]} onChange={(e) => setSel((x) => { const y = { ...x }; if (e.target.checked) y[it.listing_key] = it; else delete y[it.listing_key]; return y; })} />}</td>
                  <td data-label="Ürün" style={{ overflowWrap: "anywhere" }}>{it.title || it.listing_key}<div className="muted" style={{ fontSize: 12 }}>{it.listing_key}{Number(it.sold30) ? ` · 30 günde ${it.sold30} satış` : ""}{it.overridden ? ` · elle fiyat ${tl(n(it.override_price)!)}` : ""} · {when(it.checked_at)}</div></td>
                  <td className="n" data-label="Sıra">{it.buybox_order ?? "—"}</td>
                  <td className="n" data-label="Bizim fiyat">{n(it.our_price) != null ? tl(n(it.our_price)!) : "—"}</td>
                  <td className="n" data-label="Buybox / 2.">{n(it.buybox_price) != null ? tl(n(it.buybox_price)!) : "—"}{n(it.second_price) ? <div className="muted" style={{ fontSize: 12 }}>2.: {tl(n(it.second_price)!)}</div> : null}</td>
                  <td className="n" data-label="Net şimdi">{nn != null ? tl(nn) : "—"}</td>
                  <td className="n" data-label="Öneri">{k ? <><b style={{ color: k.color }}>{k.label}</b>{target != null && it.suggestion !== "reset" ? <div>{tl(target)}</div> : null}</> : "—"}</td>
                  <td className="n" data-label="Net öneride">{it.suggestion && it.suggestion !== "reset" && nt != null ? <span style={{ color: nt >= (nn ?? 0) ? "var(--ok)" : "var(--warn)" }}>{tl(nt)}{nn != null ? <div className="muted" style={{ fontSize: 12 }}>{nt - nn >= 0 ? "+" : ""}{tl(nt - nn)}</div> : null}</span> : "—"}</td>
                  <td data-label="">
                    {it.suggestion && <button className="btn" disabled={busy} onClick={() => approve([it])}>Onayla</button>}
                    {it.overridden && it.suggestion !== "reset" && <button className="btn ghost" disabled={busy} onClick={() => reset(it)}>Formüle dön</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="row" style={{ justifyContent: "center", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" disabled={f.page === 0} onClick={() => setF({ ...f, page: f.page - 1 })}>Önceki</button>
            <span className="muted" style={{ fontSize: 13 }}>{f.page + 1} / {pages}</span>
            <button className="btn ghost" disabled={f.page + 1 >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Sonraki</button>
          </div>
        )}
      </div>
    </>
  );
}
