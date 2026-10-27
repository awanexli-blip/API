// GitHub Actions iş akışını panelden başlat (Vercel: GH_TOKEN, fine-grained, Actions: Read and write; GH_REPO).
export async function dispatchWorkflow(file: string, inputs: Record<string, string> = {}): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return { ok: false, error: "GH_TOKEN / GH_REPO tanımlı değil" };
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/${file}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs }),
      signal: AbortSignal.timeout(15000),
    });
    return r.status === 204 ? { ok: true } : { ok: false, error: `GitHub ${r.status}` };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
