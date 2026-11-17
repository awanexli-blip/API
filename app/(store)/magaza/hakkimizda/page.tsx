import type { Metadata } from "next";
import { STORE_NAME } from "@/lib/store";

export const metadata: Metadata = { title: "Hakkımızda" };

export default function About() {
  return (
    <article className="prose panel">
      <h1>Hakkımızda</h1>
      <p>{STORE_NAME}; ev ve yaşam, elektronik, aksesuar, oyuncak, hobi ve daha birçok kategoride binlerce ürünü uygun fiyatla sunan bir çevrimiçi mağazadır.</p>
      <p>Sitemiz şu anda hazırlık aşamasındadır. Online sipariş, ödeme ve kargo seçenekleri çok yakında hizmetinizde olacak.</p>
    </article>
  );
}
