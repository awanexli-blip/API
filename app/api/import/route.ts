import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

// İçe aktarma geçmişi: GET ?job=<id> -> satırlar (hatalılar önce) · GET -> son işler
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const db = admin();
  const job = Number(req.nextUrl.searchParams.get("job"));
  if (job) {
    const { data, error } = await db.from("import_rows").select("row_no, sku, status, errors, product_id").eq("job_id", job).order("row_no").limit(5000);
    if (error) return dbError(error);
    return NextResponse.json(data);
  }
  const { data, error } = await db.from("import_jobs").select("*").order("id", { ascending: false }).limit(20);
  if (error) return dbError(error);
  return NextResponse.json(data);
}

// XML içe aktarmayı başlat (GitHub Actions: import.yml). Ağır iş Vercel'de değil Actions'ta çalışır.
export async function POST(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return NextResponse.json({ error: "GH_TOKEN veya GH_REPO ayarlı değil" }, { status: 400 });
  const res = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/import.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { actor: a.email } }),
  });
  if (res.status !== 204) return NextResponse.json({ error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 400 });
  return NextResponse.json({ ok: true });
}
