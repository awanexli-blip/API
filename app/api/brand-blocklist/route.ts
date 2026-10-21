import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";

export const dynamic = "force-dynamic";

// Gönderilmeyen markalar (tüm pazaryerleri): başlığında/açıklamasında geçen ürün gönderilmez. GET liste · POST { word } · DELETE ?word=
export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { data, error } = await admin().from("brand_blocklist").select("word, source, created_at").order("word");
  if (error) return bad(error.message.includes("brand_blocklist") ? "Supabase migration 023 çalıştırılmamış" : error.message);
  return NextResponse.json({ words: data ?? [] });
}
export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const word = String(b.word ?? "").trim().toLocaleLowerCase("tr");
  if (word.length < 2 || word.length > 60) return bad("Marka 2-60 karakter olmalı");
  const { error } = await admin().from("brand_blocklist").upsert({ word, source: "elle" }, { onConflict: "word" });
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const word = req.nextUrl.searchParams.get("word");
  if (!word) return bad("word gerekli");
  const { error } = await admin().from("brand_blocklist").delete().eq("word", word);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
