// Telegram acil durum komutları (K, 03.11: "işyerindeyken bilgisayara erişimim yokken telefondan işlerimi halledebilmek").
// Sabit komutlar (yapay zekâ yorumu yok). Canlıya etki eden her komut önce "Onayla" düğmesi ister; düğme verisi işlemin kendisidir
// (64 bayt, depolama yok): c:<işlem>:<pazaryeri>:<barkod>[:<tutar>]. Yalnızca TELEGRAM_CHAT_ID sohbeti (route.ts doğrular).
// Etki: product_overrides (gizle = stok 0, elle fiyat; worker zarar ettiren elle fiyatı uygulamaz) ve marketplace_settings.sales_paused;
// sonra senkron hemen tetiklenir (yoksa 15 dk içinde uygulanır). Müşteri bilgisi okunmaz/yazılmaz.
import { admin } from "@/lib/server";
import { dispatchSync } from "@/lib/inbox";

type Btn = { text: string; callback_data: string }[][];
export type CmdReply = { text: string; buttons?: Btn };

const MP: Record<string, string> = { t: "trendyol", h: "hepsiburada" };
const MP_LABEL: Record<string, string> = { trendyol: "Trendyol", hepsiburada: "Hepsiburada" };
const mpCode = (w?: string) => { const x = String(w ?? "").toLocaleLowerCase("tr"); return /^(ty|trendyol|t)$/.test(x) ? "t" : /^(hb|hepsiburada|h)$/.test(x) ? "h" : x === "" || x === "hepsi" ? "*" : null; };
const mpList = (c: string) => (c === "*" ? ["trendyol", "hepsiburada"] : [MP[c]]);
const mpText = (c: string) => (c === "*" ? "Trendyol + Hepsiburada" : MP_LABEL[MP[c]]);
const BARCODE = /^[A-Za-z0-9ÖöÇçŞşİıĞğÜü._\-]{3,40}$/;
const tl = (n: unknown) => `${Number(n ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} TL`;
const ok = (data: string, label = "✅ Onayla"): Btn => [[{ text: label, callback_data: data }, { text: "Vazgeç", callback_data: "c:x" }]];

export const CMD_HELP = `<b>Acil durum komutları</b> (canlıya dokunanlar onay ister)
/ara &lt;kelime&gt; — ilan bul (barkod, stok, fiyat)
/durdur &lt;barkod&gt; [ty|hb] — ürünün satışını durdur (stok 0)
/ac &lt;barkod&gt; [ty|hb] — durdurulan ürünü yeniden aç
/fiyat &lt;barkod&gt; &lt;tutar&gt; [ty|hb] — elle fiyat (zarar ettiriyorsa uygulanmaz)
/fiyatsil &lt;barkod&gt; [ty|hb] — elle fiyatı kaldır (formüle dön)
/satisdurdur [ty|hb] — TÜM satışı durdur (her ilana stok 0)
/satisac [ty|hb] — satışı yeniden aç
/senkron [ty|hb] — stok/fiyatı şimdi güncelle
Pazaryeri yazılmazsa ikisi birden. Diğer mesajlar: durum asistanı.`;

// Mesaj metni komutsa cevap, değilse null (asistana gider)
export async function handleCommand(text: string): Promise<CmdReply | null> {
  const [head, ...rest] = text.trim().split(/\s+/);
  const cmd = head.toLocaleLowerCase("tr").replace(/@\w+$/, "");
  if (!cmd.startsWith("/")) return null;
  const db = admin();
  switch (cmd) {
    case "/komutlar": case "/komut": return { text: CMD_HELP };
    case "/ara": {
      const term = rest.join(" ").replace(/[%,()*]/g, " ").trim().slice(0, 60);
      if (term.length < 2) return { text: "Kullanım: /ara &lt;ürün adında geçen kelime ya da barkod&gt;" };
      const { data, error } = await db.from("marketplace_listings").select("marketplace, listing_key, title, price, stock, status")
        .or(`listing_key.ilike.%${term}%,title.ilike.%${term}%`).in("marketplace", ["trendyol", "hepsiburada"]).order("stock", { ascending: false }).limit(8);
      if (error) return { text: `❗ ${error.message}` };
      if (!data?.length) return { text: "Bulunamadı." };
      return { text: data.map((r: any) => `${r.marketplace === "trendyol" ? "TY" : "HB"} <code>${esc(r.listing_key)}</code> · stok ${r.stock ?? 0} · ${tl(r.price)}${r.status !== "live" ? ` · ${r.status}` : ""}\n${esc(String(r.title ?? "").slice(0, 70))}`).join("\n\n") };
    }
    case "/durdur": case "/ac": case "/fiyatsil": {
      const [bc, w] = rest; const c = mpCode(w);
      if (!bc || !BARCODE.test(bc) || !c) return { text: `Kullanım: ${cmd} &lt;barkod&gt; [ty|hb]` };
      const found = await listingsOf(bc, c);
      if (!found.length) return { text: `Barkod ${esc(bc)} ${mpText(c)} ilanlarında yok. /ara ile bulun.` };
      const act = cmd === "/durdur" ? "h" : cmd === "/ac" ? "u" : "r";
      const what = act === "h" ? "satışı DURDURULSUN (stok 0)" : act === "u" ? "satışa yeniden AÇILSIN" : "elle fiyatı kaldırılsın (formül fiyatı)";
      return { text: `${esc(bc)} · ${mpText(c)}\n${found.map(describe).join("\n")}\n\n→ ${what}?`, buttons: ok(`c:${act}:${c}:${bc}`) };
    }
    case "/fiyat": {
      const [bc, p, w] = rest; const c = mpCode(w); const price = Number(String(p ?? "").replace(",", "."));
      if (!bc || !BARCODE.test(bc) || !c || !(price > 0 && price < 1_000_000)) return { text: "Kullanım: /fiyat &lt;barkod&gt; &lt;tutar&gt; [ty|hb]   ör. /fiyat OS13-ABC 499,90 ty" };
      const found = await listingsOf(bc, c);
      if (!found.length) return { text: `Barkod ${esc(bc)} ${mpText(c)} ilanlarında yok.` };
      return { text: `${esc(bc)} · ${mpText(c)}\n${found.map(describe).join("\n")}\n\n→ Fiyat ${tl(price)} olsun? (zarar ettiriyorsa worker uygulamaz, formül fiyatı kalır)`, buttons: ok(`c:p:${c}:${bc}:${Math.round(price * 100) / 100}`) };
    }
    case "/satisdurdur": case "/satisac": {
      const c = mpCode(rest[0]); if (!c) return { text: `Kullanım: ${cmd} [ty|hb]` };
      const stop = cmd === "/satisdurdur";
      return { text: stop ? `⚠️ ${mpText(c)}: satıştaki TÜM ilanların stoğu 0 yapılacak. Emin misin?` : `${mpText(c)}: satış yeniden açılsın mı? (stoklar sonraki senkronda geri gelir)`, buttons: ok(`c:${stop ? "s" : "a"}:${c}`, stop ? "⛔ Evet, durdur" : "✅ Evet, aç") };
    }
    case "/senkron": {
      const c = mpCode(rest[0]); if (!c) return { text: "Kullanım: /senkron [ty|hb]" };
      const r = await Promise.all(mpList(c).map((m) => dispatchSync(m)));
      return { text: r.every(Boolean) ? `🔄 ${mpText(c)} senkronu başladı (birkaç dakika).` : "❗ Senkron başlatılamadı (GH_TOKEN?). 15 dk içinde kendiliğinden çalışır." };
    }
    default: return null; // /start, /yardim vb. route.ts'te
  }
}

// Onay düğmesi: işlemi uygula, cevap metni döner (null = bu modülün düğmesi değil)
export async function handleCommandButton(data: string): Promise<string | null> {
  if (data === "c:x") return "Vazgeçildi";
  const m = /^c:([hurpsa]):([th*])(?::([^:]+))?(?::([0-9.]+))?$/.exec(data);
  if (!m) return null;
  const [, act, c, bc, p] = m;
  const db = admin(), mps = mpList(c);
  if (act === "s" || act === "a") {
    const { error } = await db.from("marketplace_settings").update({ sales_paused: act === "s" }).in("marketplace", mps);
    if (error) return `❗ ${error.message}`;
    await audit(act === "s" ? "satış durduruldu" : "satış açıldı", { marketplaces: mps });
    const r = await Promise.all(mps.map((x) => dispatchSync(x)));
    return `${act === "s" ? "⛔ Satış durduruldu" : "✅ Satış açıldı"}: ${mpText(c)}${r.every(Boolean) ? " · senkron başladı" : " · 15 dk içinde uygulanır"}`;
  }
  if (!bc || !BARCODE.test(bc)) return "Geçersiz barkod";
  for (const mp of mps) {
    const { data: cur } = await db.from("product_overrides").select("barcode, hidden, price_override, note").eq("marketplace", mp).eq("barcode", bc).maybeSingle();
    const row: any = { marketplace: mp, barcode: bc, hidden: cur?.hidden ?? false, price_override: cur?.price_override ?? null, note: cur?.note ?? null };
    if (act === "h") row.hidden = true;
    if (act === "u") row.hidden = false;
    if (act === "p") row.price_override = Number(p);
    if (act === "r") row.price_override = null;
    row.note = `telegram ${new Date().toISOString().slice(0, 16)}`;
    const { error } = await db.from("product_overrides").upsert(row, { onConflict: "marketplace,barcode" });
    if (error) return `❗ ${mp}: ${error.message}`;
  }
  await audit({ h: "ürün durduruldu", u: "ürün açıldı", p: "elle fiyat", r: "elle fiyat kaldırıldı" }[act] ?? act, { barcode: bc, marketplaces: mps, price: p ? Number(p) : undefined });
  const r = await Promise.all(mps.map((x) => dispatchSync(x)));
  const done = { h: "⛔ Satış durduruldu (stok 0)", u: "✅ Satışa açıldı", p: `💰 Fiyat ${tl(p)}`, r: "↩️ Elle fiyat kaldırıldı" }[act];
  return `${done}: ${bc} · ${mpText(c)}${r.every(Boolean) ? " · senkron başladı" : " · 15 dk içinde uygulanır"}`;
}

async function listingsOf(bc: string, c: string) {
  const { data } = await admin().from("marketplace_listings").select("marketplace, listing_key, title, price, stock, status").eq("listing_key", bc).in("marketplace", mpList(c));
  return data ?? [];
}
const describe = (r: any) => `${MP_LABEL[r.marketplace] ?? r.marketplace}: stok ${r.stock ?? 0} · ${tl(r.price)} · ${esc(String(r.title ?? "").slice(0, 60))}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function audit(action: string, detail: Record<string, unknown>) {
  await admin().from("audit_log").insert({ actor: "telegram", action, entity: "tg_command", entity_id: String(detail.barcode ?? ""), after: detail }).then(() => {}, () => {});
}
