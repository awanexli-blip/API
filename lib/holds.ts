import { admin } from "@/lib/server";
import { dispatchSync } from "@/lib/inbox";

// Elle değişiklik kararı (migration 074, worker/core/holds.ts): Telegram düğmesi ya da panel. Stok/fiyat gidecekse senkron hemen başlar.
export const HOLD_STATUS = { a: "keep_all", p: "keep_price", s: "sync" } as const;
export const HOLD_LABEL: Record<string, string> = { pending: "Karar bekliyor", keep_all: "Hepsi kalsın (dokunulmuyor)", keep_price: "Fiyat kalsın, stok sistemden", sync: "Sistemle eşitlenecek" };

export async function decideHold(id: string, status: "keep_all" | "keep_price" | "sync", by: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin().from("listing_holds").update({ status, decided_at: now, decided_by: by }).eq("id", id).select("marketplace, title");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Kayıt bulunamadı (zaten eşitlenmiş olabilir)" };
  const started = status !== "keep_all" ? await dispatchSync(data[0].marketplace) : false;
  return { ok: true, marketplace: data[0].marketplace as string, started };
}
