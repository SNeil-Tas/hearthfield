export function formatResourcePoints(value: number) {
  if (value <= 1e-6) return '0';
  if (value < 1) return '<1';
  return String(Math.round(value));
}
