// Tema: sistem / açık / koyu (localStorage + html[data-theme]). İlk boyama öncesi uygulama: app/layout.tsx
export type Theme = "system" | "light" | "dark";
export function applyTheme(t: Theme) {
  try { if (t === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", t); } catch {}
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
export function currentTheme(): Theme {
  try { const t = localStorage.getItem("theme"); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
}
