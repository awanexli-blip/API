"use client";
// Ürün görselleri: büyük görsel + küçük resim düğmeleri (ilk görsel LCP: yüksek öncelik, gecikmesiz)
import { useState } from "react";

export default function Gallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <div className="noimg" style={{ borderRadius: 14 }}>Görsel yok</div>;
  return (
    <div className="gallery">
      <img className="main" src={images[i]} alt={title} width={700} height={700} fetchPriority={i === 0 ? "high" : undefined} />
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
