import type { Metadata } from "next";

export const metadata: Metadata = { title: "İletişim" };

// Şirket unvanı, adres, telefon ve e-posta K'dan gelince yazılacak (mesafeli satış mevzuatı: satıcı bilgileri zorunlu)
export default function Contact() {
  return (
    <article className="prose">
      <h1>İletişim</h1>
      <p>İletişim bilgilerimiz, online satış başladığında bu sayfada yer alacaktır.</p>
    </article>
  );
}
