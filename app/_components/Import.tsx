"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { FIELD_LABEL, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS, groupRows, mapHeaders, parseCsv, toRawRows, type Field, type Group } from "@/lib/import";
import { when, type Api, type Notify, type Row } from "./shared";

type Res = { row: number; sku: string; status: string; errors?: Record<string, string> };
const STATUS_TR: Record<string, string> = {
  create: "eklenecek", update: "güncellenecek", created: "eklendi", updated: "güncellendi", stock: "stok güncellendi",
  unchanged: "değişiklik yok", skipped: "atlandı", error: "hata",
};
const JOB_TR: Record<string, string> = { running: "sürüyor", ok: "tamam", partial: "kısmen", error: "hata" };
const FIELDS = Object.keys(FIELD_LABEL) as Field[];

// Grupları istek başına en fazla ~400 satır olacak şekilde böl (bir ürünün satırları bölünmez)
function batches(groups: Group[], max = 400): Group[][] {
  const out: Group[][] = [];
  let cur: Group[] = [], n = 0;
  for (const g of groups) {
    if (n + g.rows.length > max && cur.length) { out.push(cur); cur = []; n = 0; }
    cur.push(g); n += g.rows.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function download(name: string, rows: unknown[][]) {
  const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function Import({ api, notify, isAdmin, onDone }: { api: Api; notify: Notify; isAdmin: boolean; onDone: () => void }) {
  const [file, setFile] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [fields, setFields] = useState<(Field | null)[]>([]);
  const [mode, setMode] = useState<"upsert" | "create" | "update">("upsert");
  const [checked, setChecked] = useState<Res[] | null>(null);
  const [done, setDone] = useState<Res[] | null>(null);
  const [progress, setProgress] = useState("");
  const [jobs, setJobs] = useState<Row[]>([]);
  const [jobRows, setJobRows] = useState<{ id: number; rows: Row[] } | null>(null);

  const loadJobs = useCallback(() => api("/api/import").then(setJobs).catch(() => {}), [api]);
  useEffect(() => { loadJobs(); }, [loadJobs]);
  const running = jobs.some((j) => j.status === "running");
  useEffect(() => { if (!running) return; const t = setInterval(loadJobs, 10000); return () => clearInterval(t); }, [running, loadJobs]);

  async function pick(f: File) {
    setChecked(null); setDone(null); setFile(f.name);
    try {
      let t: string[][];
      if (/\.(xlsx|xls)$/i.test(f.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        t = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }).map((r) => r.map((c) => String(c ?? "")));
        t = t.filter((r) => r.some((c) => c.trim() !== ""));
      } else t = parseCsv(await f.text());
      if (t.length < 2) throw new Error("Dosyada başlık satırı ve en az bir ürün satırı olmalı");
      if (t.length > 30001) throw new Error("Tek dosyada en fazla 30.000 satır");
      setTable(t); setFields(mapHeaders(t[0]));
    } catch (e: any) { notify("err", `Dosya okunamadı: ${e.message}`); setTable(null); }
  }

  const rows = table ? toRawRows(table, fields) : [];
  const groups = groupRows(rows);
  const hasKey = fields.includes("model") || fields.includes("variant_sku");
  const hasTitle = fields.includes("title");

  async function run(dry: boolean) {
    const out: Res[] = [];
    let job: number | undefined;
    const parts = batches(groups);
    try {
      for (const [i, part] of parts.entries()) {
        setProgress(`${dry ? "Kontrol ediliyor" : "İçe aktarılıyor"}: ${i + 1} / ${parts.length}`);
        const r = await api("/api/import/csv", { method: "POST", body: JSON.stringify({ job_id: job, filename: file, mode, dry_run: dry, final: i === parts.length - 1, groups: part }) });
        job = r.job_id; out.push(...r.results);
      }
      if (dry) setChecked(out); else { setDone(out); onDone(); loadJobs(); }
    } catch (e: any) { notify("err", e.message); if (!dry) loadJobs(); }
    finally { setProgress(""); }
  }

  async function startXml() {
    if (!confirm("BayilikXML'deki tüm ürünler ürün veritabanına aktarılsın mı? (Var olanlar güncellenir, XML'den kalkanların stoğu 0 olur, hiçbir şey silinmez.) Pazaryerlerine bir şey gönderilmez.")) return;
    try { await api("/api/import", { method: "POST" }); notify("good", "XML içe aktarma başlatıldı (GitHub Actions). İlk seferde 5-10 dakika sürebilir; aşağıdaki geçmişte görünür."); setTimeout(loadJobs, 20000); }
    catch (e: any) { notify("err", e.message); }
  }
  async function openJob(id: number) {
    if (jobRows?.id === id) return setJobRows(null);
    try { setJobRows({ id, rows: await api(`/api/import?job=${id}`) }); } catch (e: any) { notify("err", e.message); }
  }

  const summary = (list: Res[]) => Object.entries(list.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}));
  const errs = (checked ?? done ?? []).filter((r) => r.errors);

  return (
    <>
      <div className="card">
        <h2>Dosyadan içe aktar (CSV / Excel)</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Her satır bir ürün (veya bir renk/beden seçeneği). Aynı model kodlu satırlar tek ürünün seçenekleri olur. Sütun adları otomatik tanınır.
          SKU ve barkod boşsa otomatik oluşur. Var olan üründe dosyada olmayan sütunlar değişmez (ör. sadece "Model kodu" ve "Stok" ile stok güncellenir).
        </p>
        <div className="row">
          <label className="btn primary" style={{ cursor: "pointer" }}>
            Dosya seç<input type="file" accept=".csv,.txt,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
          </label>
          <button className="btn" onClick={() => download("urun-sablonu.csv", [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE])}>Şablonu indir</button>
          {file && <span className="muted">{file}: {rows.length} satır, {groups.length} ürün</span>}
        </div>

        {table && <>
          <h3 style={{ marginTop: 16, fontSize: 15 }}>Sütunlar</h3>
          <div className="grid">{table[0].map((h, i) => (
            <label key={i} className="f">{h || `(${i + 1}. sütun)`}
              <select value={fields[i] ?? ""} onChange={(e) => { const n = [...fields]; n[i] = (e.target.value || null) as Field | null; setFields(n); setChecked(null); }}>
                <option value="">— kullanma —</option>
                {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
              </select>
              <small className="muted">ör. {String(table[1]?.[i] ?? "").slice(0, 40) || "-"}</small>
            </label>
          ))}</div>
          {!hasKey && !hasTitle && <p style={{ color: "var(--bad)" }}>"Model kodu" veya "Ürün adı" sütunu seçilmeli.</p>}
          {!hasKey && hasTitle && <p className="muted" style={{ fontSize: 13 }}>Model kodu sütunu yok: her satır yeni ürün olarak eklenir, SKU otomatik oluşur.</p>}

          <div className="row" style={{ marginTop: 12 }}>
            <select value={mode} onChange={(e) => { setMode(e.target.value as any); setChecked(null); }} style={{ maxWidth: 280 }}>
              <option value="upsert">Yenileri ekle, var olanları güncelle</option>
              <option value="create">Sadece yeni ürünleri ekle</option>
              <option value="update">Sadece var olanları güncelle</option>
            </select>
            <button className="btn" disabled={!!progress || (!hasKey && !hasTitle)} onClick={() => run(true)}>1. Kontrol et</button>
            <button className="btn primary" disabled={!!progress || !checked} onClick={() => run(false)} title={!checked ? "Önce kontrol et" : ""}>2. İçe aktar</button>
            {progress && <span className="muted">{progress}</span>}
          </div>
        </>}

        {(checked || done) && <div style={{ marginTop: 12 }}>
          <div className="row">
            <b>{done ? "Sonuç:" : "Kontrol sonucu:"}</b>
            {summary(done ?? checked!).map(([s, n]) => <span key={s} className={`pill ${s === "error" ? "error" : s === "skipped" ? "partial" : "ok"}`}>{n} {STATUS_TR[s] ?? s}</span>)}
            {errs.length > 0 && <button className="btn" onClick={() => download("hatalar.csv", [["Satır", "SKU", "Durum", "Alan", "Hata"], ...errs.flatMap((r) => Object.entries(r.errors!).map(([k, m]) => [r.row, r.sku, STATUS_TR[r.status] ?? r.status, k === "_" ? "" : k, m]))])}>Hataları indir</button>}
          </div>
          {checked && !done && errs.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Hatalı satırlar içe aktarılmaz, diğerleri aktarılır. Dosyayı düzeltip tekrar seçebilirsin.</p>}
          {errs.length > 0 && <div className="scroll" style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}><table>
            <thead><tr><th className="n">Satır</th><th>SKU</th><th>Sorun</th></tr></thead>
            <tbody>{errs.slice(0, 300).map((r, i) => <tr key={i}><td className="n">{r.row}</td><td>{r.sku}</td>
              <td style={{ color: r.status === "error" ? "var(--bad)" : "var(--warn)" }}>{Object.entries(r.errors!).map(([k, m]) => `${k === "_" ? "" : `${FIELD_LABEL[k as Field] ?? k}: `}${m}`).join(" · ")}</td></tr>)}</tbody>
          </table></div>}
        </div>}
      </div>

      {isAdmin && <div className="card">
        <h2>BayilikXML'den içe aktar</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Tedarikçi XML'indeki ~25 bin ürünü ürün veritabanına alır (kaynak: xml:bayilik). Tekrar çalıştırınca yalnızca değişenler yazılır, stoklar güncellenir;
          XML'den kalkan ürünlerin stoğu 0 olur, silinmez. Pazaryerlerine bir şey gönderilmez; mevcut Trendyol senkronu aynen çalışmaya devam eder.
        </p>
        <button className="btn primary" onClick={startXml} disabled={running}>{running ? "Bir içe aktarma sürüyor..." : "XML'i şimdi içe aktar"}</button>
      </div>}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>İçe aktarma geçmişi</h2><button className="btn" onClick={loadJobs}>Yenile</button></div>
        {jobs.length === 0 ? <p className="muted">Henüz içe aktarma yok.</p> : <div className="scroll" style={{ marginTop: 8 }}><table>
          <thead><tr><th>Zaman</th><th>Kaynak</th><th>Durum</th><th className="n">Eklenen</th><th className="n">Güncellenen</th><th className="n">Stok</th><th className="n">Değişmeyen</th><th className="n">Hatalı / atlanan</th></tr></thead>
          <tbody>{jobs.map((j) => <Fragment key={j.id}>
            <tr onClick={() => openJob(j.id)} style={{ cursor: "pointer" }}>
              <td className="muted" style={{ fontSize: 13 }}>{when(j.started_at)}</td>
              <td>{j.kind === "xml" ? "BayilikXML" : j.source || "dosya"}<br /><span className="muted" style={{ fontSize: 12 }}>{j.created_by}</span></td>
              <td><span className={`pill ${j.status === "ok" ? "ok" : j.status === "error" ? "error" : "partial"}`}>{JOB_TR[j.status] ?? j.status}</span></td>
              <td className="n">{j.created}</td><td className="n">{j.updated}</td><td className="n">{j.stock_only}</td><td className="n">{j.unchanged}</td>
              <td className="n" style={{ color: j.failed ? "var(--bad)" : undefined }}>{j.failed} / {j.skipped}</td>
            </tr>
            {jobRows?.id === j.id && <tr><td colSpan={8}>
              {j.message && <p className="muted" style={{ margin: "0 0 6px" }}>{j.message}</p>}
              {jobRows!.rows.filter((r) => r.errors).length === 0 ? <span className="muted">Hatalı satır yok.</span> : <table><tbody>
                {jobRows!.rows.filter((r) => r.errors).slice(0, 300).map((r) => <tr key={r.row_no}><td className="n" style={{ width: 70 }}>{r.row_no}</td><td>{r.sku}</td><td style={{ color: r.status === "error" ? "var(--bad)" : "var(--warn)" }}>{Object.values(r.errors).join(" · ")}</td></tr>)}
              </tbody></table>}
            </td></tr>}
          </Fragment>)}</tbody>
        </table></div>}
      </div>
    </>
  );
}
