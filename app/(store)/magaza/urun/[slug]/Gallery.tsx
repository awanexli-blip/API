"use client";
// Ürün görselleri: büyük görsel + küçük resimler (masaüstünde solda dikey, telefonda altta yatay). İlk görsel LCP: yüksek öncelik.
import { useState } from "react";

export default function Gallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <div className="gallery single"><div className="main noimg">Görsel yok</div></div>;
  return (
    <div className={`gallery${images.length > 1 ? "" : " single"}`}>
      <img className="main" src={images[i]} alt={title} width={800} height={800} fetchPriority={i === 0 ? "high" : undefined} />
      {images.length > 1 && (
        <div className="thumbs" role="group" aria-label="Ürün görselleri">
          {images.map((u, n) => (
            <button key={u} type="button" aria-label={`Görsel ${n + 1}`} aria-current={n === i ? "true" : undefined} onClick={() => setI(n)}>
              <img src={u} alt="" width={64} height={64} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
