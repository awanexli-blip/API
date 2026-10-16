"use client";

import { useCallback, useEffect, useState } from "react";
import { nextScheduledRun, statusTr, when, type Props, type Row } from "./shared";

const ACTIONS: { mode: string; label: string; hint: string; confirm?: string; primary?: boolean }[] = [
  { mode: "preview", label: "Önizleme", hint: "Fiyatları hesaplar, pazaryerine hiçbir şey göndermez." },
  { mode: "update", label: "Stok ve fiyatı güncelle", hint: "Mevcut ürünlerin stok ve fiyatını gönderir.", confirm: "Mevcut ürünlerin stok ve fiyatı şimdi güncellensin mi?", primary: true },
  { mode: "create", label: "Yeni ürünleri aç", hint: "Kategorisi eşleşmiş yeni ürünleri açar.", confirm: "Kategorisi eşleşmiş yeni ürünler açılsın mı?" },
];

const POLICY_TR: Record<string, string> = { smart: "Akıllı", floor: "Sadece yükselt", keep: "Fiyata dokunma", formula: "Formüle eşitle" };

export default function Overview({ api, notify, marketplace }: Props) {
  const [runs, setRuns] = useState<Row[]>([]);
  const [s, setS] = useState<Row | null>(null);
  const [sErr, setSErr] = useState("");
  const [busy, setBusy] = useState("");
  const [toggling, setToggling] = useState(false);
  const [health, setHealth] = useState<Row | null>(null);

  // Ayarlar ve geçmiş birbirini beklemeden yüklenir
  const loadSettings = useCallback(async () => {
    setSErr("");
    try { setS(await api(`/api/settings?mp=${marketplace}`)); } catch (e: any) { setSErr(e.message); }
  }, [api, marketplace]);
  const loadRuns = useCallback(async () => {
    try { setRuns(await api(`/api/runs?mp=${marketplace}`)); } catch (e: any) { notify("err", "Çalıştırma geçmişi okunamadı: " + e.message); }
  }, [api, notify, marketplace]);
  const checkHealth = useCallback(async () => {
    setHealth({ loading: true });
    try { setHealth(await api("/api/health")); } catch (e: any) { setHealth({ ok: false, checks: [{ name: "Panel API", ok: false, detail: e.message }] }); }
  }, [api]);

  useEffect(() => { loadSettings(); loadRuns(); }, [loadSettings, loadRuns]);
  useEffect(() => { if (sErr) checkHealth(); }, [sErr, checkHealth]);

  // 1 saatten eski "running" kayıtlar yarıda kalmış sayılır
  const running = runs.some((r) => r.status === "running" && Date.now() - new Date(r.started_at).getTime() < 3600_000);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(loadRuns, 8000);
    return () => clearInterval(t);
  }, [running, loadRuns]);

  async function start(mode: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(mode);
    try {
      await api("/api/run", { method: "POST", body: JSON.stringify({ mode, marketplace }) });
      notify("good", "İş başlatıldı. GitHub Actions başlayınca aşağıdaki listede görünür (1-2 dakika).");
      setTimeout(loadRuns, 15000);
    } catch (e: any) { notify("err", e.message); }
    setBusy("");
  }

  async function toggleAuto() {
    if (!s || toggling) return;
    const next = !s.auto_sync;
    if (next && !confirm("Otomatik senkronizasyon açılsın mı? Her saat stok ve fiyatlar güncellenir.")) return;
    setToggling(true);
    try {
      const d = await api(`/api/settings?mp=${marketplace}`, { method: "PUT", body: JSON.stringify({ auto_sync: next }) });
      setS(d);
      if (d.auto_sync !== next) notify("err", "Ayar kaydedilemedi, sayfayı yenileyip tekrar dene.");
      else notify("good", next ? `Otomatik senkronizasyon açıldı. İlk çalışma: ${nextScheduledRun().toLocaleString("tr-TR")}` : "Otomatik senkronizasyon duraklatıldı.");
    } catch (e: any) { notify("err", "Kaydedilemedi: " + e.message); }
    setToggling(false);
  }

  return (
    <>
      <div className="card">
        <h2>Otomatik senkronizasyon</h2>
        <p className="muted">Her saat XML çekilir, stok ve fiyat hesaplanıp gönderilir.</p>
        {sErr ? (
          <div className="msg err">
            Ayarlar okunamadı: {sErr}
            <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={loadSettings}>Tekrar dene</button></div>
          </div>
        ) : (
          <div className="row">
            <span className={`pill ${s?.auto_sync ? "ok" : "partial"}`}>{!s ? "Yükleniyor..." : s.auto_sync ? "Açık" : "Kapalı"}</span>
            <button className={`btn ${s && !s.auto_sync ? "primary" : ""}`} onClick={toggleAuto} disabled={!s || toggling}>
              {toggling ? "Kaydediliyor..." : s?.auto_sync ? "Duraklat" : "Aç"}
            </button>
            {s?.auto_sync && <span className="muted" style={{ fontSize: 13 }}>sonraki çalışma: {nextScheduledRun().toLocaleString("tr-TR")}</span>}
            {s && <span className="muted" style={{ fontSize: 13 }}>fiyat politikası: {POLICY_TR[s.update_prices === false ? "keep" : s.existing_price_policy] ?? s.existing_price_policy}</span>}
          </div>
        )}
      </div>

      {health && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Sistem durumu</h2>
            <button className="btn" onClick={checkHealth}>Yeniden kontrol et</button>
          </div>
          {health.loading ? <p className="muted">Kontrol ediliyor...</p> : (
            <table><tbody>{(health.checks ?? []).map((c: Row) => (
              <tr key={c.name}><td>{c.ok ? "✓" : "✗"} {c.name}</td><td className={c.ok ? "muted" : "warn"}>{c.ok ? (c.detail ?? "tamam") : (c.detail ?? "eksik")}</td></tr>
            ))}</tbody></table>
          )}
        </div>
      )}

      <div className="card">
        <h2>Şimdi çalıştır</h2>
        <div className="grid">
          {ACTIONS.map((a) => (
            <div key={a.mode}>
              <button className={`btn ${a.primary ? "primary" : ""}`} disabled={!!busy} onClick={() => start(a.mode, a.confirm)}>
                {busy === a.mode ? "Başlatılıyor..." : a.label}
              </button>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{a.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Son çalıştırmalar</h2>
          <div className="row">
            {!health && <button className="btn" onClick={checkHealth}>Sistem durumu</button>}
            <button className="btn" onClick={loadRuns}>Yenile</button>
          </div>
        </div>
        {runs.length === 0 ? <p className="muted">Henüz çalıştırma yok.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th>Zaman</th><th>Mod</th><th>Durum</th><th>Sonuç</th></tr></thead>
              <tbody>{runs.filter((r) => (r.summary?.marketplace ?? "trendyol") === marketplace).map((r) => <RunRow key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function RunRow({ r }: { r: Row }) {
  const m = r.summary ?? {};
  const pm = m.priceMoves ?? {};
  const bc = m.batchCheck;
  const stale = r.status === "running" && Date.now() - new Date(r.started_at).getTime() > 3600_000;
  return (
    <tr>
      <td>{when(r.started_at)}</td>
      <td>{r.mode}{r.trigger === "schedule" ? " (zamanlı)" : ""}</td>
      <td><span className={`pill ${stale ? "error" : r.status}`}>{stale ? "Yarıda kaldı" : statusTr[r.status] ?? r.status}</span></td>
      <td>
        {r.error ? <span style={{ color: "var(--bad)" }}>{r.error}</span>
          : m.skippedRun ? <span className="muted">{m.skippedRun}</span>
          : m.xml != null ? (
            <>
              eşleşen {m.matched} · {r.mode === "preview" ? `güncellenecek ${m.update}` : `güncellenen ${m.updated}`}{m.created ? ` · açılan ${m.created}` : ""}{m.zeroed ? ` · sıfırlanan ${m.zeroed}` : ""}
              {(pm["artacak"] || pm["düşecek"]) ? <><br />fiyat: {pm["artacak"] ?? 0} artış · {pm["düşecek"] ?? 0} düşüş · {pm["aynı"] ?? 0} aynı</> : null}
              {(m.failedBatches || bc?.failedItems) ? <><br /><span style={{ color: "var(--bad)" }}>hata: {m.failedBatches ? `${m.failedBatches} paket ` : ""}{bc?.failedItems ? `${bc.failedItems} ürün` : ""}</span></> : null}
              {bc?.reasons?.length ? <details><summary>Ürün hataları</summary><pre>{bc.reasons.join("\n")}</pre></details> : null}
              <details><summary>Ayrıntı</summary><pre>{JSON.stringify(m, null, 1)}</pre></details>
            </>
          ) : <span className="muted">-</span>}
      </td>
    </tr>
  );
}
