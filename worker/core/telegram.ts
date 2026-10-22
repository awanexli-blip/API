// Telegram bildirimi (Faz 6 F10). TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID yoksa hiçbir şey göndermez.
// Mesajlara müşteri adı/telefon/adres girmez; soru metni ve ürün adı girer (kullanıcı istedi: telefondan kontrol ve onay).
export const telegramEnabled = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

// Dönen message_id (cevap düğmeleri ve "yanıtla" ile eşleştirmek için saklanır); hata fırlatmaz, null döner
export async function tgSend(text: string, buttons?: { text: string; data: string }[][]): Promise<number | null> {
  if (!telegramEnabled()) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true,
        ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!j.ok) { console.error("Telegram:", r.status, String(j.description ?? "").slice(0, 200)); return null; }
    return Number(j.result?.message_id) || null;
  } catch (e: any) { console.error("Telegram:", String(e?.message ?? e).slice(0, 200)); return null; }
}
