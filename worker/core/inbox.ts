// Faz 6 F7: müşteri soruları. (1) cevap bekleyen soruları çek -> inbox_items, (2) yapay zekâ taslağı (varsa anahtar),
// (3) Telegram'a bildir (düğmelerle onay), (4) YALNIZCA onaylanmış (approved) cevapları pazaryerine gönder.
// Otomatik cevap yok: approved durumuna yalnızca panel (/api/inbox) veya Telegram onayı (/api/telegram) geçirir.
import type { Marketplace } from "../marketplaces/types.ts";
import { draftAnswer, draftsEnabled } from "./answer-draft.ts";
import { tgSend, esc, telegramEnabled } from "./telegram.ts";

const MAX_DRAFTS = 20; // çalışma başına (maliyet koruması)

export async function syncInbox(db: any, mp: Marketplace, tone?: string | null) {
  const out: Record<string, unknown> = { fetched: 0, new: 0, drafted: 0, notified: 0, sent: 0, failed: 0, closedElsewhere: 0 };
  if (!mp.fetchQuestions) return { skipped: "pazaryerinde soru servisi yok" };

  // 4) Önce onaylı cevaplar (kullanıcı beklemesin)
  if (mp.answerQuestion) {
    const { data: ok } = await db.from("inbox_items").select("id, external_id, final_answer").eq("marketplace", mp.id).eq("status", "approved").limit(50);
    for (const it of ok ?? []) {
      // Çift gönderim koruması: yalnızca approved -> sending geçişini kazanan gönderir
      const { data: lock } = await db.from("inbox_items").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", it.id).eq("status", "approved").select("id");
      if (!lock?.length) continue;
      try {
        if (!String(it.external_id).startsWith("TEST-")) await mp.answerQuestion(it.external_id, String(it.final_answer ?? "")); // deneme sorusu pazaryerine gitmez
        await db.from("inbox_items").update({ status: "answered", answered_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", it.id);
        out.sent = (out.sent as number) + 1;
      } catch (e: any) {
        await db.from("inbox_items").update({ status: "failed", last_error: String(e?.message ?? e).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", it.id);
        out.failed = (out.failed as number) + 1;
      }
    }
  }

  // 1) Cevap bekleyenler
  const qs = await mp.fetchQuestions();
  out.fetched = qs.length;
  const ids = qs.map((q) => q.id);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("inbox_items").select("external_id").eq("marketplace", mp.id).eq("kind", "question").in("external_id", ids.slice(i, i + 300));
    for (const r of data ?? []) known.add(r.external_id);
  }
  const fresh = qs.filter((q) => !known.has(q.id));
  if (fresh.length) {
    const rows = fresh.map((q) => ({ marketplace: mp.id, kind: "question", external_id: q.id, product_title: q.productTitle || null, product_key: q.productKey, image_url: q.imageUrl, text: q.text, asked_at: q.askedAt ? new Date(q.askedAt).toISOString() : null }));
    const { error } = await db.from("inbox_items").upsert(rows, { onConflict: "marketplace,kind,external_id", ignoreDuplicates: true });
    if (error) throw new Error(`sorular yazılamadı: ${error.message}`);
    out.new = rows.length;
  }
  // Pazaryerinde artık beklemeyen (başka yerden cevaplanmış) sorular kapanır
  const waiting = new Set(ids);
  const { data: open } = await db.from("inbox_items").select("id, external_id").eq("marketplace", mp.id).eq("kind", "question").in("status", ["new", "drafted"]).limit(1000);
  const gone = (open ?? []).filter((r: any) => !waiting.has(r.external_id) && !String(r.external_id).startsWith("TEST-")).map((r: any) => r.id);
  if (gone.length) {
    await db.from("inbox_items").update({ status: "answered_elsewhere", updated_at: new Date().toISOString() }).in("id", gone);
    out.closedElsewhere = gone.length;
  }

  // 2) Taslak + 3) Telegram
  const { data: todo } = await db.from("inbox_items").select("id, external_id, text, product_title, product_key, tg_message_id, ai_draft").eq("marketplace", mp.id).eq("status", "new").order("asked_at", { ascending: true }).limit(MAX_DRAFTS);
  for (const it of todo ?? []) {
    let draft = null;
    if (draftsEnabled()) {
      const ctx = await productContext(db, mp.id, it.product_key, it.product_title);
      draft = await draftAnswer({ question: it.text, title: it.product_title ?? ctx?.title ?? "", description: ctx?.description, attributes: ctx?.attributes, tone: tone ?? undefined }).catch((e: any) => { out.draftError = String(e?.message ?? e).slice(0, 200); return null; });
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (draft) { Object.assign(patch, { status: "drafted", ai_draft: draft.answer, ai_unsure: draft.unsure, ai_note: draft.note || null }); out.drafted = (out.drafted as number) + 1; }
    if (telegramEnabled() && !it.tg_message_id) {
      const msg = `❓ <b>Yeni soru</b> (${esc(mp.label)})\n<b>Ürün:</b> ${esc(it.product_title ?? "-")}\n<b>Soru:</b> ${esc(it.text)}` +
        (draft ? `\n\n💬 <b>Taslak${draft.unsure ? " (emin değil)" : ""}:</b>\n${esc(draft.answer)}${draft.note ? `\n<i>Not: ${esc(draft.note)}</i>` : ""}\n\nGöndermek için <b>Onayla</b>; değiştirmek için bu mesajı <b>yanıtla</b> ve cevabı yaz.` : "\n\nCevabı yazmak için bu mesajı <b>yanıtla</b>.");
      const buttons = draft ? [[{ text: "✅ Onayla ve gönder", data: `qa:ok:${it.id}` }, { text: "🚫 Yoksay", data: `qa:no:${it.id}` }]] : [[{ text: "🚫 Yoksay", data: `qa:no:${it.id}` }]];
      const mid = await tgSend(msg, buttons);
      if (mid) { patch.tg_message_id = mid; out.notified = (out.notified as number) + 1; }
    }
    if (Object.keys(patch).length > 1) await db.from("inbox_items").update(patch).eq("id", it.id);
    if (!draft && !telegramEnabled()) break; // ne taslak ne bildirim: boşuna dönme
  }
  return out;
}

// Ürün bağlamı: ilan anahtarı ya da başlıkla ürün kaydı (açıklama + özellikler)
async function productContext(db: any, marketplace: string, key: string | null, title: string | null) {
  let pid: string | null = null;
  if (key) pid = (await db.from("marketplace_listings").select("product_id").eq("marketplace", marketplace).eq("listing_key", key).maybeSingle()).data?.product_id ?? null;
  if (!pid && title) pid = (await db.from("marketplace_listings").select("product_id").eq("marketplace", marketplace).eq("title", title).not("product_id", "is", null).limit(1).maybeSingle()).data?.product_id ?? null;
  if (!pid) return null;
  const { data } = await db.from("products").select("title, description, attributes").eq("id", pid).maybeSingle();
  return data ?? null;
}

// Yeni sipariş bildirimi (Telegram): yalnızca sayı, tutar, ürün adı; müşteri bilgisi yok
export async function notifyOrders(db: any, mp: Marketplace, since: string) {
  if (!telegramEnabled()) return 0;
  const { data } = await db.from("orders").select("id, order_no, total, est_net, status, created_at, needs_attention, attention_reason, order_lines(title, qty)").eq("marketplace", mp.id).gte("created_at", since).order("created_at").limit(20);
  for (const o of data ?? []) {
    const lines = (o.order_lines ?? []).map((l: any) => `${l.qty} × ${esc(l.title)}`).join("\n");
    await tgSend(`🛒 <b>Yeni sipariş</b> (${esc(mp.label)}) ${esc(o.order_no ?? "")}\n${lines}\n<b>Tutar:</b> ${Number(o.total ?? 0).toFixed(2)} TL${o.est_net != null ? ` · tahmini net ${Number(o.est_net).toFixed(2)} TL` : ""}${o.needs_attention ? `\n⚠️ ${esc(o.attention_reason ?? "dikkat")}` : ""}`);
  }
  return (data ?? []).length;
}
