import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { admin, guard, unauthorized, bad } from "@/lib/server";
import { approveAnswer } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// Telegram bot web kancası: soru bildirimi altındaki "Onayla" / "Yoksay" düğmeleri ve bildirimi "yanıtla" ile yazılan cevap.
// Doğrulama: Telegram'ın gönderdiği gizli başlık (setWebhook secret_token = TELEGRAM_WEBHOOK_SECRET) + yalnızca TELEGRAM_CHAT_ID sohbeti.
// Onay = insan onayı (kullanıcı düğmeye bastı / cevabı yazdı); gönderimi worker yapar.
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

async function tg(method: string, body: Record<string, unknown>) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).catch(() => null);
}

// Kurulum (yalnızca admin, panelden): Telegram'a bu ucu gizli başlıkla kaydeder
export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) return bad(`Vercel ortam değişkenleri eksik: ${missing.join(", ")}`);
  // Deneme: örnek soru (TEST- kimlikli; onaylansa da pazaryerine gitmez, worker "cevaplandı (deneme)" yapar)
  if ((await req.json().catch(() => ({}))).test) {
    const draft = "Merhaba, ürünümüz şarjlıdır ve kutusunda USB şarj kablosu bulunmaktadır. İyi alışverişler dileriz.";
    const { data: it, error } = await admin().from("inbox_items").insert({ marketplace: "trendyol", kind: "question", external_id: `TEST-${Date.now()}`, product_title: "Deneme ürünü: Şarjlı Masa Lambası", text: "Merhaba, bu lamba şarjlı mı, kablosu kutudan çıkıyor mu?", asked_at: new Date().toISOString(), status: "drafted", ai_draft: draft, ai_unsure: false }).select("id").single();
    if (error) return bad(error.message);
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000), body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID, parse_mode: "HTML",
      text: `🧪 <b>DENEME sorusu</b> (Trendyol'a gitmez)\n<b>Ürün:</b> Deneme ürünü: Şarjlı Masa Lambası\n<b>Soru:</b> Merhaba, bu lamba şarjlı mı, kablosu kutudan çıkıyor mu?\n\n💬 <b>Taslak:</b>\n${draft}\n\nGöndermek için <b>Onayla</b>; değiştirmek için bu mesajı <b>yanıtla</b> ve cevabı yaz.`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Onayla ve gönder", callback_data: `qa:ok:${it.id}` }, { text: "🚫 Yoksay", callback_data: `qa:no:${it.id}` }]] },
    }) }).catch(() => null);
    const j: any = await r?.json().catch(() => ({}));
    if (!j?.ok) return bad(`Telegram mesajı gitmedi: ${String(j?.description ?? r?.status ?? "bağlantı yok").slice(0, 200)}`);
    await admin().from("inbox_items").update({ tg_message_id: j.result?.message_id }).eq("id", it.id);
    return NextResponse.json({ ok: true, test: true });
  }
  const url = `${req.nextUrl.origin}/api/telegram`;
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] }), signal: AbortSignal.timeout(10000) }).catch(() => null);
  const j: any = await r?.json().catch(() => ({}));
  if (!j?.ok) return bad(`Telegram kabul etmedi: ${String(j?.description ?? r?.status ?? "bağlantı yok").slice(0, 200)}`);
  await tg("sendMessage", { chat_id: process.env.TELEGRAM_CHAT_ID, text: "✅ Panel bağlandı. Yeni sipariş ve müşteri soruları buraya gelecek." });
  return NextResponse.json({ ok: true, url });
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "", chat = String(process.env.TELEGRAM_CHAT_ID ?? "");
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN || !chat || !same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return new NextResponse("Bulunamadı", { status: 404 });
  const u = await req.json().catch(() => ({}));

  const cb = u.callback_query;
  if (cb) {
    if (String(cb.message?.chat?.id ?? "") !== chat) return NextResponse.json({ ok: true });
    const m = /^qa:(ok|no):([0-9a-f-]{36})$/.exec(String(cb.data ?? ""));
    let note = "Geçersiz işlem";
    if (m) {
      const db = admin();
      if (m[1] === "ok") {
        const { data } = await db.from("inbox_items").select("ai_draft").eq("id", m[2]).maybeSingle();
        const r = data?.ai_draft ? await approveAnswer(m[2], data.ai_draft, "telegram") : { error: "Taslak yok: mesajı yanıtlayıp cevabı yaz" };
        note = "error" in r ? String(r.error) : r.started ? "Onaylandı, gönderiliyor" : "Onaylandı, sonraki senkronda gönderilecek";
      } else {
        const { data } = await db.from("inbox_items").update({ status: "ignored", updated_at: new Date().toISOString() }).eq("id", m[2]).in("status", ["new", "drafted", "failed"]).select("id");
        note = data?.length ? "Yoksayıldı" : "Soru zaten cevaplanmış";
      }
      if (!/^(Geçersiz|Taslak yok)/.test(note)) await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message?.message_id, reply_markup: { inline_keyboard: [] } });
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: note.slice(0, 190) });
    return NextResponse.json({ ok: true });
  }

  const msg = u.message;
  if (msg && String(msg.chat?.id ?? "") === chat && msg.reply_to_message?.message_id && typeof msg.text === "string") {
    const { data } = await admin().from("inbox_items").select("id").eq("tg_message_id", msg.reply_to_message.message_id).maybeSingle();
    if (data) {
      const r = await approveAnswer(data.id, msg.text, "telegram");
      await tg("sendMessage", { chat_id: chat, reply_to_message_id: msg.message_id, text: "error" in r ? `❗ ${r.error}` : `✅ Cevap onaylandı${r.started ? ", gönderiliyor" : ", sonraki senkronda gönderilecek"}.` });
    }
  }
  return NextResponse.json({ ok: true });
}
