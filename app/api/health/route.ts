import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized } from "@/lib/server";

export const dynamic = "force-dynamic";

// Panelin bağımlılıklarını kontrol eder. Değerleri değil, yalnızca var/yok bilgisini döndürür.
export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const env = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ADMIN_EMAIL", "GH_TOKEN", "GH_REPO"];
  const checks: { name: string; ok: boolean; detail?: string }[] = env.map((k) => ({ name: k, ok: !!process.env[k] }));

  const url = process.env.SUPABASE_URL ?? "";
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) checks.push({ name: "SUPABASE_URL biçimi", ok: false, detail: "Sadece https://<proje>.supabase.co olmalı (sonunda / veya /rest/v1 olmadan)" });

  const t0 = Date.now();
  const { data, error } = await admin().from("settings").select("id,auto_sync").eq("id", 1).maybeSingle();
  checks.push({ name: "Supabase settings tablosu", ok: !error && !!data, detail: error ? error.message : !data ? "settings satırı yok (schema.sql çalıştırılmalı)" : `${Date.now() - t0} ms` });

  if (process.env.GH_TOKEN && process.env.GH_REPO) {
    try {
      const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/sync.yml`, {
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      });
      checks.push({ name: "GitHub workflow erişimi", ok: r.ok, detail: r.ok ? undefined : `GitHub ${r.status}` });
    } catch (e: any) {
      checks.push({ name: "GitHub workflow erişimi", ok: false, detail: e.message });
    }
  }
  const version = process.env.VERCEL_GIT_COMMIT_SHA ? `${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)} (${process.env.VERCEL_GIT_COMMIT_MESSAGE?.split(String.fromCharCode(10))[0].slice(0, 60) ?? ""})` : null;
  return NextResponse.json({ ok: checks.every((c) => c.ok), checks, version });
}
