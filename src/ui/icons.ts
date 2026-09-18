const paths: Record<string, string> = {
  leaf: '<path d="M19 4C8 3 3 8 5 15s12 6 14-11Z"/><path d="m5 20 10-11"/>',
  build: '<path d="m3 11 9-7 9 7M5 10v10h14V10M10 20v-7h4v7"/>',
  orders: '<path d="m5 19 9-9m-2-5 4-2 5 5-2 4-7-7ZM3 17l4 4"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  wood: '<path d="m4 16 11-9 5 6-11 9Z"/><ellipse cx="6" cy="18" rx="3" ry="4" transform="rotate(-40 6 18)"/><path d="m12 11 5 6"/>',
  food: '<path d="M6 9h12l3 10H3L6 9ZM8 9l4-6 4 6M8 13l1 4m7-4-1 4"/>',
  stone: '<path d="m3 16 4-9 10-2 5 11-8 5Z"/><path d="m7 7 7 7 8 2m-8-2v7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  home: '<path d="m3 12 9-9 9 9M6 10v11h12V10"/>',
  bed: '<path d="M4 4v17M20 9v12M4 17h16M5 10h15v7M6 7h5v3"/>',
  wall: '<path d="M3 4h18v16H3ZM3 12h18M12 4v8M8 12v8M16 12v8"/>',
  door: '<path d="M5 21V3h14v18M9 21V6h7v15M13 13h1"/>',
  stockpile: '<path d="M3 5h18v15H3ZM3 10h18M8 5v15M15 5v15M3 15h18"/>',
  save: '<path d="M4 3h13l4 4v14H3V3ZM8 3v6h8V3M7 21v-8h10v8"/>',
  journal: '<path d="M5 3h14v18H5ZM9 7h6M9 11h6M9 15h4"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="12" r="3"/>',
};
export const icon = (name: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.leaf}</svg>`;
export const escapeHTML = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
