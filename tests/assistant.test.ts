// Telegram durum asistanı (lib/assistant-core.ts): kişisel veri süzgeci, durum ifadeleri, araç döngüsü (sahte Gemini). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAssistant, scrub, scrubDeep, questionStatus, shortReason, searchTerm, type Generate, type ToolDef } from "../lib/assistant-core.ts";

test("kişisel veri süzülür: telefon, e-posta, IBAN, TC, anahtar", () => {
  const s = scrub("Ara 0532 123 45 67 ya da +90 555 1234567, mail a.b@x.com, TR12 0006 1005 1978 6457 8413 26, tc 10000000146, AIza" + "x".repeat(35));
  assert.ok(!/0532|555 1234567|a\.b@x\.com|TR12 0006|10000000146|AIzax/.test(s), s);
  assert.match(s, /\[telefon\].*\[telefon\].*\[e-posta\].*\[IBAN\].*\[TC no\].*\[anahtar\]/);
  assert.equal(scrub("Sipariş 11760100317 hazır"), "Sipariş 11760100317 hazır", "sipariş numarası kalır");
  assert.deepEqual(scrubDeep({ a: ["x@y.com", 5], b: { c: "05321234567" } }), { a: ["[e-posta]", 5], b: { c: "[telefon]" } });
});

test("soru durumu üç ayrım", () => {
  assert.match(questionStatus("answered"), /^İletildi/);
  assert.match(questionStatus("failed"), /^Gönderim denendi ama hata aldı/);
  assert.match(questionStatus("approved"), /^Bekliyor/);
  assert.match(questionStatus("drafted"), /bekliyor/i);
  assert.match(questionStatus("xyz"), /Bilinmeyen/);
});

test("hata nedeni kısaltılır, arama terimi temizlenir", () => {
  assert.equal(shortReason('Trendyol 400: Bu soru zaten cevaplanmış (/qna/sellers/1/questions/2/answers) {"x":1}'), "Trendyol 400: Bu soru zaten cevaplanmış");
  assert.equal(shortReason(""), null);
  assert.equal(searchTerm("lamba),status.eq.answered,(x"), "lamba status eq answered x");
});

const tools = (log: string[]): ToolDef[] => [
  { name: "soru_durumu", description: "", parameters: { type: "OBJECT", properties: {} }, run: async (a) => { log.push(JSON.stringify(a)); return { sorular: [{ durum: "Gönderim denendi ama hata aldı", musteri_tel: "05321234567" }] }; } },
];

test("araç döngüsü: araç çağrılır, sonuç süzülerek modele gider, metin döner", async () => {
  const log: string[] = [], sent: any[] = [];
  const gen: Generate = async (body) => {
    sent.push(body);
    if (sent.length === 1) return { status: 200, json: { candidates: [{ content: { parts: [{ functionCall: { name: "soru_durumu", args: { ara: "lamba" } } }] } }] } };
    return { status: 200, json: { candidates: [{ content: { parts: [{ text: "Gönderim denendi ama hata aldı." }] } }] } };
  };
  const r = await runAssistant("Cevabım gitti mi? numaram 05321234567", tools(log), gen);
  assert.equal(r.text, "Gönderim denendi ama hata aldı.");
  assert.deepEqual(r.used, ["soru_durumu"]);
  assert.equal(log[0], '{"ara":"lamba"}');
  const all = JSON.stringify(sent);
  assert.ok(!all.includes("05321234567"), "telefon modele gitmemeli");
  assert.ok(sent[0].tools && !JSON.stringify(sent[0]).includes("run"), "araç tanımı gider, kod gitmez");
});

test("bilinmeyen araç / araç hatası modele hata olarak döner; tur sınırı", async () => {
  let n = 0;
  const gen: Generate = async (body) => {
    n++;
    if (!body.tools) return { status: 200, json: { candidates: [{ content: { parts: [{ text: "son" }] } }] } };
    return { status: 200, json: { candidates: [{ content: { parts: [{ functionCall: { name: "yok_boyle", args: {} } }] } }] } };
  };
  const r = await runAssistant("x", tools([]), gen, 2);
  assert.equal(r.text, "son");
  assert.equal(n, 3);
});

test("kota 429 -> hata fırlatır (çağıran kullanıcıya kota mesajı yazar)", async () => {
  await assert.rejects(runAssistant("x", [], async () => ({ status: 429, json: {} })), /kota/);
});
