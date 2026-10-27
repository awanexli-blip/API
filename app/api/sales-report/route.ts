import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad, MARKETPLACES } from "@/lib/server";
import { readAll } from "@/worker/core/util";

export const dynamic = "force-dynamic";

// Satış raporu (Faz 6 F9, migration 042 sales_report): dönem KPI'ları + önceki eşit dönem, zaman serisi, pazaryeri, ürün, iade.
// GET ?period=today|yesterday|7|30|90|365|month|lastmonth|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&mp=
// GET ...&format=csv -> { filename, csv }: dönemin siparişleri ve kâr kalemleri (müşteri adı/adresi YOK)
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const trToday = () => new Date(Date.now() + 3 * 3600 * 1000); // İstanbul (UTC+3, yaz saati yok)

function range(p: string, from?: string | null, to?: string | null): [string, string] | null {
  const t = trToday();
  const today = iso(t);
  const back = (n: number) => iso(new Date(t.getTime() - n * DAY));
  switch (p) {
    case "today": return [today, today];
    case "yesterday": return [back(1), back(1)];
    case "7": case "30": case "90": case "365": return [back(Number(p) - 1), today];
    case "month": return [today.slice(0, 8) + "01", today];
    case "lastmonth": {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      return [iso(first), iso(last)];
    }
    case "custom": {
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
      if ((Date.parse(to) - Date.parse(from)) / DAY > 731) return null;
      return [from, to];
    }
    default: return null;
  }
}

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const num = (v: unknown) => (v == null || v === "" ? "" : Number(v).toFixed(2).replace(".", ","));

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const mp = sp.get("mp") || null;
  if (mp && !MARKETPLACES.includes(mp)) return bad("Geçersiz pazaryeri");
  const r = range(sp.get("period") ?? "30", sp.get("from"), sp.get("to"));
  if (!r) return bad("Geçersiz tarih aralığı (en fazla 2 yıl)");
  const [from, to] = r;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const db = admin();

  if (sp.get("format") === "csv") {
    const f = new Date(Date.parse(from) - 3 * 3600 * 1000).toISOString(), t = new Date(Date.parse(to) + DAY - 3 * 3600 * 1000).toISOString();
    // Sayfalı: .limit(20000) Supabase'in 1000 satır sınırında kalıyordu (dosya sessizce eksik çıkardı); en fazla 20.000 sipariş
    const { data, error } = await readAll((a, b) => {
      if (a >= 20000) return Promise.resolve({ data: [], error: null });
      let q = db.from("orders").select("id, marketplace, order_no, ordered_at, status, marketplace_status, total, units, fin, act_commission, return_reason, cargo_provider, city")
        .gte("ordered_at", f).lt("ordered_at", t).order("ordered_at").order("id");
      if (mp) q = q.eq("marketplace", mp);
      return q.range(a, b);
    });
    if (error) return bad(error.message);
    const head = ["Pazaryeri", "Sipariş no", "Tarih", "Durum", "Pazaryeri durumu", "Adet", "Müşterinin ödediği", "Satıcı geliri", "Komisyon (tahmini)", "Komisyon (gerçek)", "Kargo", "Sabit gider", "Ürün maliyeti", "Ödenecek KDV", "İade masrafı", "Stopaj (%1)", "Net kâr", "İade nedeni", "Kargo firması", "İl"];
    const rows = (data ?? []).map((o: any) => [o.marketplace, o.order_no, new Date(o.ordered_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }), o.status, o.marketplace_status, o.units,
      num(o.total), num(o.fin?.revenue), num(o.fin?.commission), num(o.act_commission), num(o.fin?.shipping), num(o.fin?.service), num(o.fin?.cost), num(o.fin?.vat_due), num(o.fin?.return_loss), num(o.fin?.stopaj),
      num(o.fin?.net != null && o.act_commission != null && !["cancelled", "returned"].includes(o.status) ? Number(o.fin.net) + (Number(o.fin.commission) - Number(o.act_commission)) / 1.2 : o.fin?.net),
      o.return_reason, o.cargo_provider, o.city].map(csvCell).join(";"));
    // Panel yetki başlığıyla JSON ister; dosyayı tarayıcı oluşturur (BOM'lu UTF-8, ayraç ;, Excel'de Türkçe düzgün)
    return NextResponse.json({ filename: `satis_${from}_${to}${mp ? "_" + mp : ""}.csv`, csv: "\ufeff" + [head.join(";"), ...rows].join("\r\n"), rows: rows.length });
  }

  const bucket = days <= 45 ? "day" : days <= 180 ? "week" : "month";
  const { data, error } = await db.rpc("sales_report", { p_from: from, p_to: to, p_mp: mp, p_bucket: bucket });
  if (error) return bad(error.message);
  return NextResponse.json({ ...data, days });
}
