// Vitrin simgeleri (satır içi SVG, dış dosya yok)
const P: Record<string, React.ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h10" /></>,
  home: <><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  back: <><path d="M15 6l-6 6 6 6" /></>,
  next: <><path d="M9 6l6 6-6 6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
};
export default function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

// 8 köşeli yıldız (Osmanlı çini motifi): logo işareti. İki iç içe kare, 45° döndürülmüş.
export function Star() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
      <rect x="7" y="7" width="18" height="18" rx="1.5" />
      <rect x="7" y="7" width="18" height="18" rx="1.5" transform="rotate(45 16 16)" />
      <circle cx="16" cy="16" r="4.2" fill="var(--card, #fff)" />
    </svg>
  );
}
// Giriş bandı deseni (soluk çini: yıldız çizgisi). CSS değişkeni olarak verilir.
export const STAR_PATTERN = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#1f4e9e" stroke-opacity=".16" stroke-width="1.2"><rect x="18" y="18" width="28" height="28"/><rect x="18" y="18" width="28" height="28" transform="rotate(45 32 32)"/><circle cx="32" cy="32" r="5"/><path d="M0 32h8M56 32h8M32 0v8M32 56v8"/></svg>')}")`;
