"use client";

// Henüz bağlanmamış pazaryerleri: bağlantı için gerekenler ve ürün açarken zorunlu alanlar.
// Kaynak ve ayrıntı: docs/TODO.md "Pazaryeri zorunlu alanları"

export type MarketInfo = { id: string; label: string; needs: string[]; required: string[]; notes: string[] };

export const UPCOMING: MarketInfo[] = [
  {
    id: "hepsiburada",
    label: "Hepsiburada",
    needs: ["Merchant ID", "API kullanıcı adı ve şifresi (Hepsiburada Satıcı Paneli > Entegrasyon)", "Komisyon oranları (kategori bazında)"],
    required: ["Satıcı stok kodu (merchantSku)", "Kategori", "Ürün adı", "Marka", "Açıklama", "Görseller (en az 1)", "KDV oranı", "Fiyat ve stok", "Desi / ağırlık", "Varyant grubu (varyantlı ürünlerde)", "Kategoriye özel zorunlu özellikler (renk, beden, garanti süresi...)"],
    notes: ["Ürünler toplu yüklenir, sonuç takip numarasıyla kontrol edilir.", "Marka \"Eco Lounge\" Hepsiburada'da kayıtlı mı kontrol edilmeli."],
  },
  {
    id: "n11",
    label: "N11",
    needs: ["API anahtarı (appKey) ve şifresi (appSecret) — N11 Mağaza Paneli > Hesabım > API", "Teslimat şablonu adı (panelde tanımlı)"],
    required: ["Başlık (15–65 karakter)", "Açıklama", "Kategori", "Model kodu (productMainId)", "Stok kodu", "Fiyat ve para birimi", "KDV (0/1/10/20)", "Stok", "Görseller", "Teslimat şablonu ve hazırlık süresi", "Marka ve kategoriye özel zorunlu özellikler"],
    notes: ["65 karakter sınırı yüzünden uzun Trendyol başlıkları kısaltılacak."],
  },
  {
    id: "amazon",
    label: "Amazon TR",
    needs: ["Amazon Seller Central hesabı (Türkiye)", "SP-API geliştirici kaydı ve yetkilendirme (refresh token)", "Barkod muafiyeti (GTIN exemption) veya marka tescili"],
    required: ["Ürün tipi (productType)", "Ürün adı", "Marka", "EAN/GTIN veya muafiyet", "Durum (yeni)", "Fiyat", "Stok", "Madde işaretli özellikler", "Açıklama", "Ana görsel", "Menşei ülke", "Ürün tipine göre ek alanlar"],
    notes: ["XML'deki barkodlar gerçek EAN değil. Muafiyet olmadan yeni ürün açılamaz.", "En son eklenecek."],
  },
];

export default function Upcoming({ info }: { info: MarketInfo }) {
  return (
    <>
      <div className="card">
        <h2>{info.label} henüz bağlı değil</h2>
        <p className="muted">Stok/fiyat güncelleme ve ürün açma, Trendyol ile aynı XML ve fiyat formülüyle çalışacak. Komisyon ve kargo kuralları bu pazaryerine göre ayrı ayarlanacak.</p>
        <h3>Bağlamak için gerekenler</h3>
        <ul>{info.needs.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <div className="card">
        <h2>Ürün açarken zorunlu alanlar</h2>
        <ul className="cols">{info.required.map((x) => <li key={x}>{x}</li>)}</ul>
        {info.notes.length > 0 && <><h3>Notlar</h3><ul>{info.notes.map((x) => <li key={x}>{x}</li>)}</ul></>}
        <p className="muted" style={{ fontSize: 13 }}>Kategoriye özel zorunlu özellikler bağlantıdan sonra pazaryerinin kendi servisinden otomatik çekilecek.</p>
      </div>
    </>
  );
}
