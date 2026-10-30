"use client";

import { useCallback, useEffect, useState } from "react";
import { tl, when, type Api, type Notify, type Row } from "./shared";

// Elle değişen / eklenen ilanlar (/api/holds, migration 074): pazaryerinde elle yapılan değişiklik senkronla ezilmez, karar burada ya da Telegram'da.
const MP: Record<string, string> = { trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon TR" };
const ST: Record<string, [string, string]> = { pending: ["Karar bekliyor", "partial"], keep_all: ["Hepsi kalsın", "ok"], keep_price: ["Fiyat kalsın, stok sistemden", "ok"], sync: ["Eşitlenecek", "info"] };

export default function Holds({ api, notify }: { api: Api; notify: Notify }) {
  const [d, setD] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api("/api/holds").then(setD).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { load(); }, [load]);
  if (!d || (!d.rows?.length && !d.missing)) return null;

  async function decide(id: string, status: string) {
    setBusy(id);
    try { const r = await api("/api/holds", { method: "POST", body: JSON.stringify({ id, status }) }); notify("good", `Kaydedildi${r.started ? ", senkron başladı" : ""}.`); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  const pending = d.rows.filter((r: Row) => r.status === "pending").length;
  return (
    <div className="card">
      <h2>Elle değişen ilanlar{pending ? ` (${pending} karar bekliyor)` : ""}</h2>
      {d.missing ? <p className="muted" style={{ fontSize: 13 }}>Koruma kapalı: Supabase'de migration 074 çalıştırılmamış.</p> : <>
        <p className="muted" style={{ fontSize: 13 }}>Pazaryerinde elle düzenlediğin ya da eklediğin ilanlar. Karar verene kadar senkron bunlara dokunmaz. "Fiyat kalsın" seçilirse stok tedarikçiden güncellenir. "Sistemle eşitle" bir kez gönderir ve kaydı kapatır.</p>
        <div className="scroll"><table className="cards">
          <thead><tr><th>İlan</th><th className="n">Pazaryerinde</th><th className="n">Sistem</th><th>Durum</th><th></th></tr></thead>
          <tbody>{d.rows.map((r: Row) => (
            <tr key={r.id}>
              <td data-label="İlan" style={{ fontSize: 13 }}>{r.title || r.listing_key}<br /><span className="muted" style={{ fontSize: 12 }}>{MP[r.marketplace] ?? r.marketplace} · {r.listing_key} · {r.kind === "manual_new" ? "elle eklenmiş" : "elle düzenlenmiş"} · {when(r.detected_at)}</span></td>
              <td data-label="Pazaryerinde" className="n">{r.mp_price != null ? tl(Number(r.mp_price)) : "-"}<br /><span className="muted">{r.mp_qty ?? "-"} adet</span></td>
              <td data-label="Sistem" className="n">{r.our_price != null ? tl(Number(r.our_price)) : r.our_qty === 0 ? "stok 0" : "-"}<br /><span className="muted">{r.our_qty ?? "-"} adet</span></td>
              <td data-label="Durum"><span className={`pill ${ST[r.status]?.[1] ?? ""}`}>{ST[r.status]?.[0] ?? r.status}</span>{r.decided_by && <div className="muted" style={{ fontSize: 12 }}>{r.decided_by}</div>}</td>
              <td>{r.status !== "sync" && <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {r.status !== "keep_all" && <button className="btn ghost" style={{ fontSize: 12 }} disabled={!!busy} onClick={() => decide(r.id, "keep_all")}>Hepsi kalsın</button>}
                {r.status !== "keep_price" && <button className="btn ghost" style={{ fontSize: 12 }} disabled={!!busy} onClick={() => decide(r.id, "keep_price")}>Fiyat kalsın</button>}
                <button className="btn ghost" style={{ fontSize: 12 }} disabled={!!busy} onClick={() => confirm("Bu ilanın fiyat ve stoğu sistemin değerleriyle değiştirilecek. Devam?") && decide(r.id, "sync")}>Sistemle eşitle</button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </div>
  );
}
