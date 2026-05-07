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
import { dbRowToCandle, alignTimestamp, type CoinParams } from "@/lib/price-engine";

interface PriceChartProps {
  coinId: string;
  symbol: string;
  initialParams: CoinParams;
  timeframe?: "1m" | "5m" | "15m" | "1h";
  height?: number;
  onPriceUpdate?: (price: number) => void;
}

/**
 * Gráfico de precios.
 * Escucha cambios en `coins.current_price` vía Supabase Realtime.
 * Cuando llega un precio nuevo, actualiza la vela actual en pantalla.
 * El motor real corre en el servidor (pg_cron), no en el cliente.
 */
export function PriceChart({
  coinId,
  symbol,
  initialParams,
  timeframe = "1m",
  height = 400,
  onPriceUpdate,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);

  const [loading, setLoading] = useState(true);

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
        // Mostrar timestamps en zona horaria local del usuario
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000);
          if (timeframe === "1h") {
            return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
          }
          return d.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
            second: timeframe === "1m" ? "2-digit" : undefined,
          });
        },
      },
      localization: {
        locale: "es-AR",
        timeFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return d.toLocaleString("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        },
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
        .order("timestamp", { ascending: false })
        .limit(500);

      if (cancelled || !seriesRef.current) return;

      // Vienen en desc, los doy vuelta para que estén en asc
      const ordered = (rows || []).slice().reverse();
      const candles: CandlestickData<Time>[] = ordered.map((r: any) => {
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
      }
      chartRef.current?.timeScale().fitContent();
      setLoading(false);
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [coinId, timeframe]);

  // Suscribirse a Realtime: cambios en coins.current_price
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`coin-price-${coinId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "coins",
          filter: `id=eq.${coinId}`,
        },
        (payload: any) => {
          if (!seriesRef.current) return;

          const newPrice = Number(payload.new.current_price);
          if (!newPrice || isNaN(newPrice)) return;

          const aligned = alignTimestamp(new Date(), timeframe);
          const time = Math.floor(aligned.getTime() / 1000) as Time;

          // Si cae en la misma vela actual → update
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

          onPriceUpdate?.(newPrice);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coinId, timeframe, onPriceUpdate]);

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
