import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad } from "@/lib/server";
import { approveAnswer } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// Müşteri soruları (Faz 6 F7): liste, onayla (cevap pazaryerine bir sonraki senkronda / hemen gider), yoksay.
// Hiçbir cevap onaysız gitmez. Ton tercihi: GET ?tone=1 / PUT { tone }.
const STATUSES = ["", "new", "drafted", "approved", "sending", "answered", "failed", "ignored", "answered_elsewhere"];

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "open";
  if (status !== "open" && !STATUSES.includes(status)) return bad("Geçersiz filtre");
  const db = admin();
  let q: any = db.from("inbox_items").select("id, marketplace, product_title, image_url, text, asked_at, status, ai_draft, ai_unsure, ai_note, final_answer, approved_by, answered_at, last_error").order("asked_at", { ascending: false }).limit(100);
  if (status === "open") q = q.in("status", ["new", "drafted", "failed", "approved", "sending"]);
  else if (status) q = q.eq("status", status);
  const [ls, cnt, st] = await Promise.all([
    q,
    db.from("inbox_items").select("status").limit(5000),
    db.from("settings").select("answer_tone").eq("id", 1).maybeSingle(),
  ]);
  if (ls.error) return bad(ls.error.message);
  const counts: Record<string, number> = {};
  for (const r of cnt.data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return NextResponse.json({ items: ls.data ?? [], counts, tone: st.data?.answer_tone ?? "", telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
}

// { id, action: "approve", text } | { id, action: "ignore" } | { tone }
export async function PUT(req: NextRequest) {
  const a = await requireRole(req, "editor");
  if (!a) return forbidden("editor");
  const b = await req.json().catch(() => ({}));
  const db = admin();
  if (typeof b.tone === "string") {
    const { error } = await db.from("settings").update({ answer_tone: b.tone.trim().slice(0, 500) || null }).eq("id", 1);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }
  const id = String(b.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("Geçersiz soru");
  if (b.action === "approve") {
    const r = await approveAnswer(id, String(b.text ?? ""), a.email);
    return "error" in r ? bad(r.error!) : NextResponse.json(r);
  }
  if (b.action === "ignore") {
    const { data, error } = await db.from("inbox_items").update({ status: "ignored", updated_at: new Date().toISOString() }).eq("id", id).in("status", ["new", "drafted", "failed"]).select("id");
    if (error) return bad(error.message);
    return data?.length ? NextResponse.json({ ok: true }) : bad("Soru bulunamadı ya da gönderiliyor");
  }
  return bad("Geçersiz işlem");
}
