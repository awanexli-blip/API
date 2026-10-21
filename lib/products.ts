// Ürün API'leri için sunucu tarafı yardımcılar
import { NextRequest, NextResponse } from "next/server";
import { getActor, unauthorized, forbidden, type Actor, type Role } from "@/lib/server";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

// Giriş yoksa 401, rol yetmiyorsa 403
export async function authorize(req: NextRequest, min: Role): Promise<Actor | NextResponse> {
  const a = await getActor(req);
  if (!a) return unauthorized();
  if (RANK[a.role] < RANK[min]) return forbidden(min);
  return a;
}

// Postgres hatasını kullanıcıya anlaşılır mesaja çevir
export function dbError(e: { code?: string; message?: string; details?: string } | null) {
  const msg = e?.message ?? "Bilinmeyen veritabanı hatası";
  switch (e?.code) {
    case "23505": {
      const what = /barcode/.test(msg) ? "Barkod" : "SKU";
      const val = e?.details?.match(/=\((.*)\)/)?.[1];
      return NextResponse.json({ error: `${what} başka bir üründe kullanılıyor${val ? `: ${val}` : ""}` }, { status: 409 });
    }
    case "23514": return NextResponse.json({ error: `Geçersiz değer (${msg})` }, { status: 400 });
    case "P0002": return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
    case "22023": return NextResponse.json({ error: msg }, { status: 400 });
    default:
      console.error("db hatası", e?.code ?? "", msg.slice(0, 300));
      return NextResponse.json({ error: `Veritabanı hatası${e?.code ? ` (${e.code})` : ""}; ayrıntı sunucu günlüğünde` }, { status: 500 });
  }
}
