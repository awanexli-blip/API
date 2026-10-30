// GİB e-Arşiv portalı istemcisi (resmî API yok; portalın kendi arayüzünün kullandığı uçlar, açık kaynak f/fatura MIT, Ağustos 2026'dan).
// Yalnızca: giriş, taslak oluşturma, taslak/fatura listesi, çıkış. İMZALAMA YOK: K taslakları portalda toplu seçip tek SMS ile imzalar
// (yasal onay kullanıcıda kalır). Kimlik: GIB_PORTAL_USER / GIB_PORTAL_PASS (Vercel, Sensitive); loglanmaz, hata mesajına girmez.
// GİB komut adlarını değiştirebilir (2026'da değiştirdi): hata metni panelde gösterilir, elle kesmeye devam edilebilir.

export type EarsivFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: () => Promise<string> }>;
export type EarsivDoc = { ettn: string; belgeNumarasi?: string; onayDurumu?: string; aliciVknTckn?: string; aliciUnvanAdSoyad?: string; belgeTarihi?: string; [k: string]: unknown };

const BASE = { PROD: "https://earsivportal.efatura.gov.tr", TEST: "https://earsivportaltest.efatura.gov.tr" };
const HEADERS = { accept: "*/*", "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "accept-language": "tr,en-US;q=0.9,en;q=0.8", "cache-control": "no-cache", pragma: "no-cache" };
const defaultFetch: EarsivFetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(45000) });

export class EarsivClient {
  private token = "";
  private base: string;
  private user: string;
  private pass: string;
  private env: "PROD" | "TEST";
  private f: EarsivFetch;
  constructor(user: string, pass: string, env: "PROD" | "TEST" = "PROD", f: EarsivFetch = defaultFetch) {
    this.user = user; this.pass = pass; this.env = env; this.f = f;
    this.base = BASE[env];
  }

  private async post(path: string, form: Record<string, string>) {
    const r = await this.f(`${this.base}${path}`, { method: "POST", headers: HEADERS, body: new URLSearchParams(form).toString() });
    const text = await r.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* düz metin */ }
    if (r.status >= 400) throw new Error(`GİB portalı ${r.status}`);
    if (j && j.error && j.error !== "0") throw new Error(`GİB: ${String(j.messages?.[0]?.text ?? j.messages?.[0] ?? j.error).slice(0, 200)}`);
    return j ?? text;
  }

  // Oturum anahtarı dışarıda saklanabilsin (portal tek oturum; yarıda kalan iş sonra kapatılabilsin)
  get sessionToken() { return this.token; }
  useToken(t: string) { this.token = t; }

  async login() {
    if (!this.user || !this.pass) throw new Error("GİB portal kullanıcı kodu / şifresi tanımlı değil (Vercel: GIB_PORTAL_USER, GIB_PORTAL_PASS)");
    const j = await this.post("/earsiv-services/assos-login", { assoscmd: this.env === "PROD" ? "anologin" : "login", rtype: "json", userid: this.user, sifre: this.pass, sifre2: this.pass, parola: "1" });
    if (!j?.token) throw new Error("GİB portalına giriş yapılamadı (kullanıcı kodu / şifre?)");
    this.token = String(j.token);
  }

  // Portal aynı kullanıcıyla tek oturuma izin verir ("birden fazla kişi giriş yapamaz"): çıkış yapılmazsa K portala giremez.
  // 30.10: f/fatura'daki "anologin" çıkışı oturumu kapatmadı; önce "logout", olmazsa "anologin" denenir.
  async logout() {
    if (!this.token) return;
    for (const assoscmd of ["logout", "anologin"]) {
      const r = await this.f(`${this.base}/earsiv-services/assos-login`, { method: "POST", headers: HEADERS, body: new URLSearchParams({ assoscmd, rtype: "json", token: this.token }).toString() }).catch(() => null);
      const t = r ? await r.text().catch(() => "") : "";
      if (r && r.status < 400 && !/"error"\s*:\s*"[^0]/.test(t)) break;
    }
    this.token = "";
  }

  private dispatch(cmd: string, pageName: string, jp: unknown) {
    if (!this.token) throw new Error("GİB oturumu yok");
    return this.post("/earsiv-services/dispatch", { cmd, callid: crypto.randomUUID(), pageName, token: this.token, jp: JSON.stringify(jp) });
  }

  // Taslaklar ve imzalanmış faturalar (tarih aralığı GG/AA/YYYY)
  async list(from: string, to: string): Promise<EarsivDoc[]> {
    const j = await this.dispatch("EARSIV_PORTAL_TASLAKLARI_GETIR", "RG_BASITTASLAKLAR", { baslangic: from, bitis: to, hangiTip: "5000/30000", table: [] });
    return Array.isArray(j?.data) ? j.data : [];
  }

  // Taslak oluşturur; ETTN'yi GİB verir: aynı günün listesi önce/sonra karşılaştırılır
  async createDraft(invoice: Record<string, unknown>): Promise<EarsivDoc> {
    const day = String(invoice.faturaTarihi);
    const before = new Set((await this.list(day, day)).map((d) => d.ettn));
    const r = await this.dispatch("EARSIV_PORTAL_FATURA_OLUSTUR", "RG_BASITFATURA", invoice);
    const msg = typeof r === "string" ? r : String(r?.data ?? "");
    if (!/başarıyla oluşturulmuştur/i.test(msg)) throw new Error(`Taslak oluşturulamadı: ${msg.replace(/\s+/g, " ").slice(0, 200) || "GİB yanıtı boş"}`);
    const created = (await this.list(day, day)).filter((d) => !before.has(d.ettn));
    if (created.length !== 1) throw new Error(`Taslak oluştu ama ETTN bulunamadı (${created.length} yeni kayıt): portalda kontrol et`);
    return created[0];
  }
}

export const isSigned = (d: EarsivDoc) => /^onaylandı$/i.test(String(d.onayDurumu ?? "").trim());
export const isDeleted = (d: EarsivDoc) => /silin/i.test(String(d.onayDurumu ?? ""));
