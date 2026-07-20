// ui.js — piccoli helper di disegno (SVG) e utility riusate da app.js

function ringSvg(percent, color, size, stroke) {
  size = size || 60; stroke = stroke || 7;
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = percent === null || percent === undefined ? 0 : percent;
  const off = c * (1 - Math.min(Math.max(pct, 0), 100) / 100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--muted)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size/2} ${size/2})"/>
  </svg>`;
}

function sparklineSvg(values, color) {
  const w = 110, h = 32;
  const usable = values.map(v => (v === null || v === undefined) ? null : v);
  const nums = usable.filter(v => v !== null);
  if (nums.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const max = Math.max(...nums), min = Math.min(...nums), range = (max - min) || 1;
  const step = w / (usable.length - 1);
  const pts = usable.map((v, i) => v === null ? null : `${(i*step).toFixed(1)},${(h-((v-min)/range)*h).toFixed(1)}`).filter(Boolean).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// "debounce": aspetta che l'utente smetta di muovere lo slider per un attimo
// prima di inviare la richiesta al server, invece di mandarne una per ogni
// singolo pixel di trascinamento.
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
