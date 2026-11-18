import Icon from "./Icon";

// Müşteriye güven veren mağaza taahhütleri (K 18.11). Metinler K'nın verdiği koşullar; değişirse yalnızca burası güncellenir.
export const FREE_SHIP_MIN = 500;
export const ASSURANCES = [
  { icon: "truck", title: "Ücretsiz kargo", text: `${FREE_SHIP_MIN} TL ve üzeri siparişlerde` },
  { icon: "shield", title: "Güvenli ödeme", text: "3D Secure, karta taksit" },
  { icon: "return", title: "Kolay iade", text: "14 iş günü içinde" },
  { icon: "receipt", title: "Kurumsal fatura", text: "Şirketiniz adına faturalı alışveriş" },
  { icon: "lock", title: "Güvenli alışveriş", text: "SSL ile şifreli bağlantı" },
] as const;

// Ana sayfa / alt bilgi şeridi
export function AssuranceBar() {
  return (
    <section className="assure" aria-label="Alışveriş güvencesi">
      <ul>
        {ASSURANCES.map((a) => (
          <li key={a.title}><span className="ic"><Icon name={a.icon} size={22} /></span><span><b>{a.title}</b><small>{a.text}</small></span></li>
        ))}
      </ul>
    </section>
  );
}

// Ürün sayfası (fiyat kutusunun altında, kısa liste); fiyat eşiği geçiyorsa kargo satırı ürüne özel
export function AssuranceList({ price }: { price: number }) {
  const free = price >= FREE_SHIP_MIN;
  return (
    <ul className="assure-list" aria-label="Alışveriş güvencesi">
      <li><Icon name="truck" size={18} /><span>{free ? <><b>Bu ürün ücretsiz kargo</b></> : <>{FREE_SHIP_MIN} TL ve üzeri siparişlerde <b>ücretsiz kargo</b></>}</span></li>
      {ASSURANCES.slice(1, 4).map((a) => <li key={a.title}><Icon name={a.icon} size={18} /><span><b>{a.title}:</b> {a.text}</span></li>)}
    </ul>
  );
}
