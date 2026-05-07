"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from "lightweight-charts";
import {
  generateTick,
  alignTimestamp,
  dbRowToCandle,
  type CoinParams,
  type Candle,
} from "@/lib/price-engine";
import { recordTickAction } from "@/app/actions/coins";

interface PriceChartProps {
  coinId: string;
  symbol: string;
  initialParams: CoinParams;
  timeframe?: "1m" | "5m" | "15m" | "1h";
  /** Si está en true, el cliente actualiza el precio en tiempo real (motor) */
  liveUpdate?: boolean;
  /** Si está en true, escribe los ticks a la DB cada N segundos */
  persistTicks?: boolean;
  height?: number;
  onPriceUpdate?: (price: number) => void;
}

const TICK_INTERVAL_MS = 1500; // un tick cada 1.5 segundos visualmente
const PERSIST_INTERVAL_MS = 5000; // graba en DB cada 5 segundos

export function PriceChart({
  coinId,
  symbol,
  initialParams,
  timeframe = "1m",
  liveUpdate = true,
  persistTicks = false,
  height = 400,
  onPriceUpdate,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const paramsRef = useRef<CoinParams>(initialParams);
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);
  const lastPersistedRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number>(initialParams.current_price);

  // Update params ref si cambian props
  useEffect(() => {
    paramsRef.current = { ...initialParams, current_price: currentPrice };
  }, [initialParams, currentPrice]);

  // Setup chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      },
      grid: {
        vertLines: { color: "rgba(75, 85, 99, 0.2)" },
        horzLines: { color: "rgba(75, 85, 99, 0.2)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(75, 85, 99, 0.4)" },
      timeScale: {
        borderColor: "rgba(75, 85, 99, 0.4)",
        timeVisible: true,
        secondsVisible: timeframe === "1m",
      },
      width: containerRef.current.clientWidth,
      height,
      autoSize: true,
    });

    const series = chart.addCandlestickSeries({
      upColor: "rgb(34, 197, 94)",
      downColor: "rgb(239, 68, 68)",
      borderVisible: false,
      wickUpColor: "rgb(34, 197, 94)",
      wickDownColor: "rgb(239, 68, 68)",
      priceFormat: {
        type: "price",
        precision: initialParams.decimals,
        minMove: Math.pow(10, -initialParams.decimals),
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Resize handler
    const resize = () => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height);
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, timeframe, initialParams.decimals]);

  // Cargar histórico inicial
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadHistory() {
      setLoading(true);

      const { data: rows } = await supabase
        .from("price_history")
        .select("timestamp, open, high, low, close, volume")
        .eq("coin_id", coinId)
        .eq("timeframe", timeframe)
        .order("timestamp", { ascending: true })
        .limit(500);

      if (cancelled || !seriesRef.current) return;

      const candles: CandlestickData<Time>[] = (rows || []).map((r: any) => {
        const c = dbRowToCandle(r);
        return {
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
      });

      seriesRef.current.setData(candles);
      if (candles.length > 0) {
        lastCandleRef.current = candles[candles.length - 1];
        const last = candles[candles.length - 1];
        setCurrentPrice(last.close);
      }
      chartRef.current?.timeScale().fitContent();
      setLoading(false);
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [coinId, timeframe]);

  // Loop del motor en cliente
  useEffect(() => {
    if (!liveUpdate) return;

    const interval = setInterval(() => {
      if (!seriesRef.current) return;

      const tick = generateTick(paramsRef.current);
      const newPrice = tick.price;

      const aligned = alignTimestamp(tick.timestamp, timeframe);
      const time = (Math.floor(aligned.getTime() / 1000)) as Time;

      // Si cae en la misma vela actual, actualizo close, high, low
      if (lastCandleRef.current && lastCandleRef.current.time === time) {
        const c = lastCandleRef.current;
        const updated: CandlestickData<Time> = {
          time: c.time,
          open: c.open,
          high: Math.max(c.high, newPrice),
          low: Math.min(c.low, newPrice),
          close: newPrice,
        };
        lastCandleRef.current = updated;
        seriesRef.current.update(updated);
      } else {
        // Nueva vela
        const newCandle: CandlestickData<Time> = {
          time,
          open: lastCandleRef.current?.close ?? newPrice,
          high: newPrice,
          low: newPrice,
          close: newPrice,
        };
        lastCandleRef.current = newCandle;
        seriesRef.current.update(newCandle);
      }

      setCurrentPrice(newPrice);
      onPriceUpdate?.(newPrice);

      // Persistir cada N ms
      if (persistTicks && Date.now() - lastPersistedRef.current > PERSIST_INTERVAL_MS) {
        lastPersistedRef.current = Date.now();
        recordTickAction(coinId, newPrice).catch(() => {
          // ignore
        });
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [liveUpdate, persistTicks, coinId, timeframe, onPriceUpdate]);

  return (
    <div className="relative">
      <div ref={containerRef} style={{ width: "100%", height }} />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="text-sm text-muted-foreground">Cargando gráfico...</div>
        </div>
      )}
    </div>
  );
}
