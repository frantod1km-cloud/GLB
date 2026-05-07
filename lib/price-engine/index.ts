/**
 * Motor de precios para Golbit
 *
 * Usa Geometric Brownian Motion (GBM) sesgado para generar movimientos
 * realistas de precio.
 *
 * Fórmula:
 *   precio_nuevo = precio_actual * exp(drift + volatility * Z)
 *   donde Z ~ N(0, 1) es ruido gaussiano (Box-Muller)
 *
 * El drift es el sesgo direccional (positivo = sube, negativo = baja).
 * La volatility es cuánto fluctúa por tick.
 */

export interface CoinParams {
  current_price: number;
  volatility: number; // 0-1, ej 0.02
  drift_bias: number; // -1 a 1
  spread_percent: number; // ej 0.1
  decimals: number;
  tick_seconds: number;
}

export interface Tick {
  price: number;
  bid: number;
  ask: number;
  timestamp: Date;
}

/**
 * Genera un número aleatorio con distribución normal estándar (Box-Muller)
 */
function gaussianRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Calcula el siguiente precio según el modelo GBM con drift sesgado
 */
export function nextPrice(params: CoinParams): number {
  const { current_price, volatility, drift_bias } = params;
  // Suavizar el drift: lo que viene en drift_bias está en escala "amplia",
  // dividimos para que en cada tick sea más sutil
  const drift = drift_bias * 0.001;
  const z = gaussianRandom();
  const newPrice = current_price * Math.exp(drift + volatility * z);

  // Asegurar que no caiga a 0 o se vuelva negativo
  return Math.max(newPrice, current_price * 0.01);
}

/**
 * Calcula bid (precio compra) y ask (precio venta) usando spread
 */
export function calculateBidAsk(price: number, spreadPercent: number): { bid: number; ask: number } {
  const halfSpread = spreadPercent / 2 / 100;
  return {
    bid: price * (1 - halfSpread), // Lo que un usuario "vende" (precio que recibe)
    ask: price * (1 + halfSpread), // Lo que un usuario "compra" (precio que paga)
  };
}

/**
 * Genera un tick completo con todos los datos
 */
export function generateTick(params: CoinParams): Tick {
  const newPrice = nextPrice(params);
  const { bid, ask } = calculateBidAsk(newPrice, params.spread_percent);
  return {
    price: newPrice,
    bid,
    ask,
    timestamp: new Date(),
  };
}

/**
 * Formatea un precio con los decimales correctos
 */
export function formatCoinPrice(price: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
}

/**
 * Calcula el cambio porcentual entre dos precios
 */
export function priceChangePercent(oldPrice: number, newPrice: number): number {
  if (oldPrice === 0) return 0;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Tipo de vela OHLC
 */
export interface Candle {
  time: number; // timestamp en segundos
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Convierte una fila de price_history a una vela compatible con lightweight-charts
 */
export function dbRowToCandle(row: any): Candle {
  return {
    time: Math.floor(new Date(row.timestamp).getTime() / 1000),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume ? Number(row.volume) : undefined,
  };
}

/**
 * Obtener el inicio de un timeframe dado un timestamp
 * (alineado igual que la DB)
 */
export function alignTimestamp(date: Date, timeframe: string): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);

  switch (timeframe) {
    case "1m":
      return d;
    case "5m": {
      const m = d.getMinutes();
      d.setMinutes(Math.floor(m / 5) * 5);
      return d;
    }
    case "15m": {
      const m = d.getMinutes();
      d.setMinutes(Math.floor(m / 15) * 15);
      return d;
    }
    case "1h":
      d.setMinutes(0);
      return d;
    default:
      return d;
  }
}
