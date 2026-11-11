import { NextRequest, NextResponse } from "next/server";
import { guard, unauthorized, bad, MARKETPLACES } from "@/lib/server";

export const dynamic = "force-dynamic";

const MODES = ["preview", "update", "create", "auto"];

// GitHub Actions workflow'unu tetikler
export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { mode, marketplace = "trendyol" } = (await req.json().catch(() => ({}))) ?? {};
  if (!MODES.includes(mode)) return bad("Geçersiz mod");
  if (!MARKETPLACES.includes(marketplace)) return bad("Geçersiz pazaryeri");
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return bad("GH_TOKEN veya GH_REPO ayarlı değil");

  const res = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/sync.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // part=all: panelden elle çalıştırma tam senkron (çökme yedeği); zamanlı GitHub çalışması ops/github-sync-part.txt ile yalnızca sipariş (K 12.11)
    body: JSON.stringify({ ref: "main", inputs: { mode, marketplace, part: "all" } }),
  });
  if (res.status === 403 || res.status === 404)
    return bad(`GitHub ${res.status}: GH_TOKEN bu repoya erişemiyor. Token'da "Repository access" içinde ${process.env.GH_REPO} seçili ve "Actions: Read and write" izni olmalı (süresi dolmuş da olabilir). Yeni token'ı Vercel'de GH_TOKEN'a yazıp Redeploy et.`);
  if (res.status !== 204) return bad(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return NextResponse.json({ ok: true });
}
