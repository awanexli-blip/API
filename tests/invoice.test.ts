// e-Arşiv taslak faturası (lib/invoice-build.ts) ve portal istemcisi (lib/earsiv.ts, sahte portal). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, buildInvoice, splitName, trDateTime } from "../lib/invoice-build.ts";
import { EarsivClient, isSigned, type EarsivFetch } from "../lib/earsiv.ts";

const order = { order_no: "11765608195", ordered_at: "2026-10-30T18:37:10Z", customer_name: "Ayşe Nur Yılmaz", city: "İstanbul",
  address: { fullAddress: "Örnek Mah. 1. Sok. No:2", district: "Kadıköy", city: "İstanbul", postalCode: "34000" },
  lines: [{ title: "Duplo Yapım Plakası", qty: 1, unit_price: 446.4, ty_discount: 23.5, vat_rate: 20 }, { title: "Kitap", qty: 2, unit_price: 50, vat_rate: 10 }] };

test("tutar: satış geliri (müşteri + Trendyol indirimi), KDV içinden, toplamlar tutarlı", () => {
  const inv = buildInvoice(order, new Date("2026-10-30T20:30:00Z"));
  const [a, b] = inv.malHizmetTable;
  assert.equal(a.kdvOrani, "20"); assert.equal(a.fiyat, "391.58"); assert.equal(a.kdvTutari, "78.32"); // 469,90 KDV dahil
  assert.equal(b.miktar, 2); assert.equal(b.kdvOrani, "10"); assert.equal(b.birimFiyat, "45.45"); assert.equal(b.fiyat, "90.90"); assert.equal(b.kdvTutari, "9.10");
  assert.equal(inv.vergilerDahilToplamTutar, "569.90"); assert.equal(inv.odenecekTutar, "569.90");
  assert.equal((Number(inv.matrah) + Number(inv.hesaplanankdv)).toFixed(2), inv.odenecekTutar);
  assert.equal(inv.vknTckn, "11111111111"); assert.equal(inv.aliciAdi, "Ayşe Nur"); assert.equal(inv.aliciSoyadi, "Yılmaz");
  assert.equal(inv.faturaTarihi, "30/10/2026"); assert.equal(inv.saat, "23:30:00"); assert.equal(inv.siparisNumarasi, "11765608195"); assert.equal(inv.siparisTarihi, "30/10/2026");
  assert.equal(inv.faturaUuid, ""); assert.equal(inv.ulke, "Türkiye"); assert.equal(inv.mahalleSemtIlce, "Kadıköy");
});

test("yazıyla tutar ve ad ayırma", () => {
  assert.equal(amountInWords(1279.9), "YalnızBinİkiYüzYetmişDokuzTürkLirasıDoksanKuruş");
  assert.equal(amountInWords(100), "YalnızYüzTürkLirası");
  assert.equal(amountInWords(2_351_001.05), "YalnızİkiMilyonÜçYüzElliBirBinBirTürkLirasıBeşKuruş");
  assert.deepEqual(splitName("Tek"), { ad: "Tek", soyad: "" });
  assert.deepEqual(trDateTime(new Date("2026-12-31T22:30:00Z")), { date: "01/01/2027", time: "01:30:00" });
  assert.throws(() => buildInvoice({ ...order, lines: [] }), /satırı yok/);
});

// Sahte portal: giriş -> liste (boş) -> oluştur -> liste (1 yeni ETTN)
function fakePortal(opts: { createMsg?: string; loginOk?: boolean } = {}) {
  const calls: { path: string; form: URLSearchParams }[] = [];
  let drafts: any[] = [{ ettn: "eski-1", onayDurumu: "Onaylandı" }];
  const f: EarsivFetch = async (url, init) => {
    const form = new URLSearchParams(init.body); const path = new URL(url).pathname; calls.push({ path, form });
    const json = (o: unknown) => ({ status: 200, text: async () => JSON.stringify(o) });
    if (path.endsWith("assos-login")) return form.get("assoscmd") === "anologin" && opts.loginOk !== false && form.get("userid") ? json({ token: "T1" }) : json({ error: "1", messages: [{ text: "Hatalı giriş" }] });
    const cmd = form.get("cmd");
    if (cmd === "EARSIV_PORTAL_TASLAKLARI_GETIR") return json({ data: drafts });
    if (cmd === "EARSIV_PORTAL_FATURA_OLUSTUR") { const msg = opts.createMsg ?? "Faturanız başarıyla oluşturulmuştur."; if (/başarıyla/.test(msg)) drafts = [...drafts, { ettn: "yeni-ettn", onayDurumu: "Onaylanmadı" }]; return json({ data: msg }); }
    return json({ error: "1", messages: ["bilinmeyen"] });
  };
  return { f, calls };
}

test("portal: giriş, taslak oluştur, ETTN bulunur; imza komutu hiç çağrılmaz", async () => {
  const p = fakePortal();
  const c = new EarsivClient("kod", "şifre&x", "PROD", p.f);
  await c.login();
  const inv = buildInvoice(order);
  const { _ozet, ...payload } = inv;
  const doc = await c.createDraft(payload);
  assert.equal(doc.ettn, "yeni-ettn");
  const create = p.calls.find((x) => x.form.get("cmd") === "EARSIV_PORTAL_FATURA_OLUSTUR")!;
  assert.equal(create.form.get("pageName"), "RG_BASITFATURA"); assert.equal(create.form.get("token"), "T1");
  assert.equal(JSON.parse(create.form.get("jp")!).odenecekTutar, "569.90");
  assert.ok(!JSON.parse(create.form.get("jp")!)._ozet, "iç özet GİB'e gitmez");
  assert.equal(p.calls[0].form.get("sifre"), "şifre&x", "şifre doğru kodlanır");
  assert.ok(!p.calls.some((x) => /IMZALA|SMS|0lhozfib/i.test(x.form.get("cmd") ?? "")), "imzalama yok");
  assert.ok(isSigned({ ettn: "x", onayDurumu: "Onaylandı" }) && !isSigned({ ettn: "x", onayDurumu: "Onaylanmadı" }));
});

test("portal: hatalı giriş ve başarısız oluşturma açık hata verir", async () => {
  await assert.rejects(new EarsivClient("kod", "x", "PROD", fakePortal({ loginOk: false }).f).login(), /Hatalı giriş/);
  await assert.rejects(new EarsivClient("", "", "PROD", fakePortal().f).login(), /tanımlı değil/);
  const c = new EarsivClient("kod", "x", "PROD", fakePortal({ createMsg: "Ettn ya eksik ya boş" }).f);
  await c.login();
  const { _ozet, ...payload } = buildInvoice(order);
  await assert.rejects(c.createDraft(payload), /Taslak oluşturulamadı: Ettn ya eksik/);
});
