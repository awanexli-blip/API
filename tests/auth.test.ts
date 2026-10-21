// Yetki kararı birim testleri (S1.3). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRole } from "../lib/auth-rules.ts";

const roles: Record<string, "viewer" | "editor"> = { "ed@x.com": "editor" };
const lookup = async (e: string) => roles[e] ?? null;
const ok = "2026-10-01T00:00:00Z";

test("doğrulanmamış e-posta: yetki yok (ADMIN_EMAIL olsa bile)", async () => {
  assert.equal(await resolveRole({ email: "boss@x.com", email_confirmed_at: null }, "boss@x.com", lookup), null);
});
test("doğrulanmış + rol yok: yetki yok", async () => {
  assert.equal(await resolveRole({ email: "yok@x.com", email_confirmed_at: ok }, "boss@x.com", lookup), null);
});
test("ADMIN_EMAIL: admin (büyük/küçük harf duyarsız)", async () => {
  assert.deepEqual(await resolveRole({ email: "Boss@X.com", email_confirmed_at: ok }, "boss@x.com", lookup), { email: "boss@x.com", role: "admin" });
});
test("user_roles: tablodaki rol", async () => {
  assert.deepEqual(await resolveRole({ email: "ed@x.com", email_confirmed_at: ok }, "boss@x.com", lookup), { email: "ed@x.com", role: "editor" });
});
test("kullanıcı yok: yetki yok", async () => {
  assert.equal(await resolveRole(null, "boss@x.com", lookup), null);
});
