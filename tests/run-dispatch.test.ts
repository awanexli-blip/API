// Panelden iş başlatma (lib/github.ts): sunucu ana sistemken (RUN_SITE=sunucu) istek sunucu iş kuyruğuna dosya olarak yazılır,
// GitHub'a gidilmez; parametre doğrulanır. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchWorkflow, dispatchSync } from "../lib/github.ts";

test("RUN_SITE=sunucu: kuyruğa .json yazılır, GitHub çağrılmaz", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runq-"));
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => { fetched = true; return new Response(null, { status: 204 }); }) as typeof fetch;
  try {
    process.env.RUN_SITE = "sunucu"; process.env.RUN_QUEUE_DIR = dir; process.env.GH_TOKEN = "x"; process.env.GH_REPO = "a/b";
    assert.deepEqual(await dispatchWorkflow("sync.yml", { mode: "update", marketplace: "trendyol", part: "all" }), { ok: true });
    assert.equal(await dispatchSync("hepsiburada"), true);
    const files = readdirSync(dir);
    assert.equal(files.length, 2);
    assert.ok(files.every((f) => f.endsWith(".json") && !f.startsWith(".")), "yarım (.tmp) dosya kalmaz");
    const reqs = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))).sort((a, b) => a.inputs.marketplace.localeCompare(b.inputs.marketplace));
    assert.deepEqual(reqs.map((r) => [r.file, r.inputs.mode, r.inputs.marketplace]), [["sync.yml", "update", "hepsiburada"], ["sync.yml", "update", "trendyol"]]);
    assert.equal(fetched, false, "sunucuda GitHub çağrılmaz");
    // Geçersiz parametre ve izinsiz iş reddedilir (kuyruğa yazılmaz)
    assert.equal((await dispatchWorkflow("sync.yml", { mode: "update; rm -rf /" })).ok, false);
    assert.equal((await dispatchWorkflow("evil.yml" as any)).ok, false);
    assert.equal(readdirSync(dir).length, 2);
  } finally {
    globalThis.fetch = realFetch; process.env = env; rmSync(dir, { recursive: true, force: true });
  }
});

test("RUN_SITE yok: GitHub iş akışı çağrılır", async () => {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  let url = "", body: any = null;
  globalThis.fetch = (async (u: any, init: any) => { url = String(u); body = JSON.parse(init.body); return new Response(null, { status: 204 }); }) as typeof fetch;
  try {
    delete process.env.RUN_SITE; process.env.GH_TOKEN = "x"; process.env.GH_REPO = "a/b";
    assert.equal(await dispatchSync("trendyol"), true);
    assert.equal(url, "https://api.github.com/repos/a/b/actions/workflows/sync.yml/dispatches");
    assert.deepEqual(body, { ref: "main", inputs: { mode: "update", marketplace: "trendyol" } });
  } finally { globalThis.fetch = realFetch; process.env = env; }
});
