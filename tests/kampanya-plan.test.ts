// Kampanya indirim payı (worker/kampanya-plan.ts): yuvarlama ve zarar etmeyen en büyük indirim. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { downPsych, maxDiscount } from "../worker/kampanya-plan.ts";

test("indirimli fiyat aşağı x9,90'a yuvarlanır", () => {
  assert.equal(downPsych(214), 209.9);
  assert.equal(downPsych(219.9), 219.9);
  assert.equal(downPsych(220), 219.9);
});

test("en büyük indirim alt sınırı bozmayan basamaktır", () => {
  const netAt = (p: number) => p - 80;
  assert.equal(maxDiscount(200, netAt, 40, [0.1, 0.2, 0.3]), 0.3); // 139,90 -> 59,90 net
  assert.equal(maxDiscount(130, netAt, 40, [0.1, 0.2]), 0);         // 109,90 -> 29,90 net: ilk basamak bile olmaz
});

test("basamak kırılınca aramayı bırakır", () => {
  // Kargo basamağı yüzünden ileride yeniden kârlı görünse de ilk bozulan basamakta durulur
  const netAt = (p: number) => (p >= 180 ? 50 : p >= 150 ? 10 : 90);
  assert.equal(maxDiscount(200, netAt, 40, [0.05, 0.2, 0.3]), 0.05);
});
