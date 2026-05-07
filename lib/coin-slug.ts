/**
 * Convierte un símbolo de moneda en slug URL-friendly
 * Ej: "GLB/USDT" → "GLB-USDT"
 *     "FAKE-BTC/USDT" → "FAKE_BTC-USDT" (preserva el guion original con underscore)
 */
export function symbolToSlug(symbol: string): string {
  return symbol.replace(/-/g, "_").replace(/\//g, "-");
}

/**
 * Convierte un slug URL en símbolo de moneda
 * Ej: "GLB-USDT" → "GLB/USDT"
 *     "FAKE_BTC-USDT" → "FAKE-BTC/USDT"
 */
export function slugToSymbol(slug: string): string {
  return slug.replace(/-/g, "/").replace(/_/g, "-");
}
