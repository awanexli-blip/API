"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { when, type Api, type Notify, type Row } from "./shared";

const ST: Record<string, [string, string]> = {
  new: ["Yeni", "info"], drafted: ["Taslak hazır", "info"], approved: ["Onaylandı, gönderilecek", "ok"], sending: ["Gönderiliyor", "ok"],
  answered: ["Cevaplandı", "ok"], failed: ["Gönderilemedi", "error"], ignored: ["Yoksayıldı", ""], answered_elsewhere: ["Pazaryerinden cevaplanmış", ""],
};
const FILTERS: [string, string][] = [["open", "Bekleyen"], ["answered", "Cevaplanan"], ["ignored", "Yoksayılan"], ["", "Tümü"]];

// Müşteri soruları: yapay zekâ taslağı önerir, cevap YALNIZCA burada veya Telegram'da onaylanınca pazaryerine gider
export default function Inbox({ api, notify }: { api: Api; notify: Notify }) {
  const [d, setD] = useState<Row | null>(null);
  const [filter, setFilter] = useState("open");
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [tone, setTone] = useState<string | null>(null);
  const load = useCallback(() => api(`/api/inbox?status=${filter}`).then((x) => { setD(x); setTone((t) => t ?? x.tone ?? ""); }).catch((e) => notify("err", e.message)), [api, notify, filter]);
  useEffect(() => { load(); }, [load]);

  async function act(it: Row, action: "approve" | "ignore") {
    if (action === "approve" && !confirm("Bu cevap müşteriye pazaryerinde gönderilecek. Onaylıyor musun?")) return;
    setBusy(it.id);
    try {
      const r = await api("/api/inbox", { method: "PUT", body: JSON.stringify({ id: it.id, action, text: text[it.id] ?? it.ai_draft ?? "" }) });
      notify("good", action === "ignore" ? "Yoksayıldı." : r.started ? "Onaylandı; gönderim başlatıldı (birkaç dakika)." : "Onaylandı; bir sonraki senkronda (en geç 15 dk) gönderilecek.");
      load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function connectTelegram() {
    try { await api("/api/telegram", { method: "PUT" }); notify("good", "Telegram bağlandı; bota bir deneme mesajı gönderildi."); } catch (e: any) { notify("err", e.message); }
  }
  async function saveTone() {
    try { await api("/api/inbox", { method: "PUT", body: JSON.stringify({ tone: tone ?? "" }) }); notify("good", "Ton kaydedildi; yeni taslaklarda kullanılır."); } catch (e: any) { notify("err", e.message); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const c = d.counts ?? {};
  const open = (c.new ?? 0) + (c.drafted ?? 0) + (c.failed ?? 0);
  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Pazaryerinden cevap bekleyen sorular 15 dakikada bir gelir. Yapay zekâ ürün bilgisine göre <b>taslak</b> yazar; emin olmadığı yerleri işaretler.
          Cevap <b>sen onaylamadan gönderilmez</b>. {d.telegram ? "Telegram'dan da onaylayabilir ya da bildirimi yanıtlayarak cevap yazabilirsin." : "Telegram bağlı değil (bildirim ve telefondan onay için TELEGRAM_* ayarları gerekir)."}
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Bekleyen</div><div className="value" style={{ color: open ? "var(--warn)" : undefined }}>{open}</div></div>
          <div className="kpi"><div className="label">Gönderilecek</div><div className="value">{(c.approved ?? 0) + (c.sending ?? 0)}</div></div>
          <div className="kpi"><div className="label">Cevaplanan</div><div className="value">{c.answered ?? 0}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div className="seg">{FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
        </div>
        {d.items.length === 0 ? <div className="empty"><Icon name="check" size={28} /><p>Bu filtrede soru yok.</p></div> : d.items.map((it: Row) => {
          const [label, tone2] = ST[it.status] ?? [it.status, ""];
          const editable = ["new", "drafted", "failed"].includes(it.status);
          return (
            <div key={it.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
              <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 10 }}>
                {it.image_url ? <img src={it.image_url} alt="" width={48} height={48} style={{ objectFit: "cover", borderRadius: 8, flex: "none" }} /> : null}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="muted" style={{ fontSize: 12 }}>{it.marketplace} · {when(it.asked_at)} · <span className={`pill ${tone2}`}>{label}</span></div>
                  <b style={{ overflowWrap: "anywhere" }}>{it.product_title ?? "Ürün"}</b>
                  <p style={{ margin: "4px 0", overflowWrap: "anywhere" }}>❓ {it.text}</p>
                  {it.last_error && <div style={{ fontSize: 13, color: "var(--bad)" }}>{it.last_error}</div>}
                  {editable ? (
                    <>
                      {it.ai_unsure && <div style={{ fontSize: 13, color: "var(--warn)" }}>⚠ Taslak emin değil{it.ai_note ? `: ${it.ai_note}` : ""}</div>}
                      {!it.ai_unsure && it.ai_note && <div className="muted" style={{ fontSize: 13 }}>Not: {it.ai_note}</div>}
                      <textarea rows={3} style={{ width: "100%", marginTop: 6 }} placeholder={it.ai_draft ? "" : "Cevabı yaz (taslak yok: ANTHROPIC_API_KEY tanımlı değil ya da henüz üretilmedi)"} value={text[it.id] ?? it.ai_draft ?? ""} onChange={(e) => setText({ ...text, [it.id]: e.target.value })} maxLength={2000} />
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        <button className="btn primary" disabled={busy === it.id || (text[it.id] ?? it.ai_draft ?? "").trim().length < 10} onClick={() => act(it, "approve")}>{busy === it.id ? "..." : "Onayla ve gönder"}</button>
                        <button className="btn ghost" disabled={busy === it.id} onClick={() => act(it, "ignore")}>Yoksay</button>
                      </div>
                    </>
                  ) : (it.final_answer ? <p className="muted" style={{ margin: "4px 0", fontSize: 13, overflowWrap: "anywhere" }}>💬 {it.final_answer}{it.approved_by ? ` (onaylayan: ${it.approved_by})` : ""}</p> : null)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cevap tonu</h3>
        <label className="f">Taslaklara eklenecek tercih (ör. "Samimi ol, kargo 1-3 iş günü içinde çıkar de")
          <textarea rows={2} value={tone ?? ""} onChange={(e) => setTone(e.target.value)} maxLength={500} />
          <small>Buraya yazdığın bilgiyi yapay zekâ doğru kabul eder; yalnızca kesin bildiğin şeyleri yaz.</small>
        </label>
        <button className="btn" style={{ marginTop: 8 }} onClick={saveTone}>Kaydet</button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Telegram</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Yeni sipariş ve sorular telefonuna gelir; soruyu oradan <b>Onayla</b> ile gönderebilir ya da mesajı yanıtlayıp kendi cevabını yazabilirsin.
          Kurulum: @BotFather'dan bot aç, jetonu ve sohbet numaranı GitHub Secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) ve Vercel'e (aynı ikisi + TELEGRAM_WEBHOOK_SECRET) gir, sonra aşağıdaki düğmeye bas.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={connectTelegram}>Telegram'ı bağla</button>
          <button className="btn ghost" onClick={async () => { try { await api("/api/telegram", { method: "PUT", body: JSON.stringify({ test: true }) }); notify("good", "Deneme sorusu Telegram'a gönderildi: onayla ya da yanıtla (pazaryerine gitmez)."); load(); } catch (e: any) { notify("err", e.message); } }}>Deneme sorusu gönder</button>
        </div>
      </div>
    </>
  );
}
