"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { tl, when, type Props, type Row } from "./shared";

const FILTERS: [string, string, string][] = [
  ["winnable", "Kârla alınabilir", "Buybox başkasında; 1 TL altına inersek hâlâ kâr var"],
  ["lost", "Buybox başkasında", "Aynı ürünü daha ucuza satan var"],
  ["won", "Buybox bizde", "Rakip var ama en uygun biziz"],
  ["alone", "Rakipsiz", "Bu ürünü yalnız biz satıyoruz"],
  ["all", "Tümü", ""],
];
const n = (v: unknown) => (v == null ? null : Number(v));

// Rekabet (Trendyol Ürün Buybox Kontrol): worker satıştaki ilanların buybox sırasını ve fiyatını okur, kâr hesabıyla yazar.
// Fiyat kendiliğinden değişmez: "Bu fiyata in" elle fiyat kaydeder, sonraki senkronda gönderilir (zarar ettiren fiyat uygulanmaz).
export default function Competition({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [f, setF] = useState({ filter: "winnable", q: "", page: 0 });
  const [qText, setQText] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api(`/api/buybox?mp=${marketplace}&filter=${f.filter}&q=${encodeURIComponent(f.q)}&page=${f.page}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, marketplace, f]);
  useEffect(() => { load(); }, [load]);

  async function apply(it: Row, price: number) {
    if (!confirm(`${it.title}\nFiyat ${tl(price)} olacak (sonraki senkronda Trendyol'a gider). Onaylıyor musun?`)) return;
    setBusy(it.listing_key);
    try { await api(`/api/buybox?mp=${marketplace}`, { method: "POST", body: JSON.stringify({ listing_key: it.listing_key, price }) }); notify("good", "Kaydedildi; sonraki senkronda (en geç 15 dk) gönderilir."); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function reset(it: Row) {
    setBusy(it.listing_key);
    try { await api(`/api/buybox?mp=${marketplace}`, { method: "DELETE", body: JSON.stringify({ listing_key: it.listing_key }) }); notify("good", "Elle fiyat kaldırıldı; formül fiyatına dönülecek."); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const s = d.summary ?? {};
  const pages = Math.ceil(Number(d.total ?? 0) / 50);
  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Aynı ürünü satan başka satıcılar varsa Trendyol en uygun teklifi öne çıkarır (buybox). Her senkronda 2.000 ilan kontrol edilir; tüm mağaza birkaç saatte bir döner.
          Fiyat kendiliğinden değişmez: <b>Bu fiyata in</b> dediğin ilan sonraki senkronda gönderilir. Zarar ettiren fiyat uygulanmaz. Son kontrol: {when(s.last)}.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Kontrol edilen</div><div className="value">{Number(s.checked ?? 0).toLocaleString("tr-TR")}</div><div className="hint">{Number(s.competition ?? 0).toLocaleString("tr-TR")} ilanda rakip var</div></div>
          <div className="kpi"><div className="label">Buybox bizde</div><div className="value" style={{ color: "var(--ok)" }}>{Number(s.won ?? 0).toLocaleString("tr-TR")}</div><div className="hint">rakipli ilanlarda</div></div>
          <div className="kpi"><div className="label">Buybox başkasında</div><div className="value" style={{ color: s.lost ? "var(--warn)" : undefined }}>{Number(s.lost ?? 0).toLocaleString("tr-TR")}</div></div>
          <div className="kpi"><div className="label">Kârla alınabilir</div><div className="value" style={{ color: s.winnable ? "var(--accent)" : undefined }}>{Number(s.winnable ?? 0).toLocaleString("tr-TR")}</div><div className="hint">1 TL altına inersek net kâr kalıyor</div></div>
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
        {!d.items.length ? <div className="empty"><Icon name="check" size={28} /><p>{s.checked ? "Bu filtrede ilan yok." : "Henüz kontrol yapılmadı; ilk sonuçlar bir sonraki senkronda gelir."}</p></div> : (
          <table className="cards" style={{ marginTop: 8 }}>
            <thead><tr><th>Ürün</th><th className="n">Sıra</th><th className="n">Bizim fiyat</th><th className="n">Buybox</th><th className="n">Net (şimdi)</th><th className="n">Öneri</th><th /></tr></thead>
            <tbody>{d.items.map((it: Row) => {
              const target = n(it.target_price), nt = n(it.net_at_target);
              return (
                <tr key={it.listing_key}>
                  <td data-label="Ürün" style={{ overflowWrap: "anywhere" }}>{it.title || it.listing_key}<div className="muted" style={{ fontSize: 12 }}>{it.listing_key}{Number(it.sold30) ? ` · 30 günde ${it.sold30} satış` : ""}{it.overridden ? " · elle fiyat" : ""}</div></td>
                  <td className="n" data-label="Sıra">{it.buybox_order ?? "—"}</td>
                  <td className="n" data-label="Bizim fiyat">{n(it.our_price) != null ? tl(n(it.our_price)!) : "—"}</td>
                  <td className="n" data-label="Buybox">{n(it.buybox_price) != null ? tl(n(it.buybox_price)!) : "—"}{n(it.second_price) ? <div className="muted" style={{ fontSize: 12 }}>2.: {tl(n(it.second_price)!)}</div> : null}</td>
                  <td className="n" data-label="Net (şimdi)">{n(it.net_now) != null ? tl(n(it.net_now)!) : "—"}</td>
                  <td className="n" data-label="Öneri">{target != null ? <>{tl(target)}<div style={{ fontSize: 12, color: (nt ?? 0) > 0 ? "var(--ok)" : "var(--bad)" }}>net {nt != null ? tl(nt) : "—"}</div></> : "—"}</td>
                  <td data-label="">
                    {target != null && (nt ?? 0) > 0 && <button className="btn" disabled={busy === it.listing_key} onClick={() => apply(it, target)}>Bu fiyata in</button>}
                    {it.overridden && <button className="btn ghost" disabled={busy === it.listing_key} onClick={() => reset(it)}>Formüle dön</button>}
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
