import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { admin } from "@/lib/server";

export const dynamic = "force-dynamic";

// Herkese açık fatura PDF'i (K 17.11, Hepsiburada fatura linki): /api/invoice-file/<64 hex>.
// Token tahmin edilemez; veritabanında order_invoices.file_token olarak kayıtlı değilse (silinmiş/iptal) 404. Dosya worker/invoice-upload.ts'in yazdığı imzalı e-Arşiv PDF'i.
const DIR = process.env.INVOICE_FILE_DIR || "/var/lib/trentakip/invoices";
const notFound = () => new NextResponse("Bulunamadı", { status: 404, headers: { "X-Robots-Tag": "noindex" } });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[a-f0-9]{64}$/.test(token)) return notFound();
  const { data, error } = await admin().from("order_invoices").select("belge_no").eq("file_token", token).maybeSingle();
  if (error) return new NextResponse("Geçici hata", { status: 503 });
  if (!data) return notFound();
  const pdf = await readFile(join(DIR, `${token}.pdf`)).catch(() => null);
  if (!pdf) return notFound();
  const name = `fatura-${String(data.belge_no ?? "").replace(/[^A-Za-z0-9-]/g, "") || "e-arsiv"}.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`,
    "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
  } });
}
