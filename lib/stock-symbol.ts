export function normalizeStockSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.:-]{0,15}$/.test(symbol) ? symbol : null;
}
