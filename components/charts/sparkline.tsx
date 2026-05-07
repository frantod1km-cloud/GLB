"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  trend?: "up" | "down" | "neutral";
}

export function Sparkline({ data, width = 120, height = 40, trend }: SparklineProps) {
  if (!data || data.length < 2) {
    return <div className="text-xs text-muted-foreground/50 italic">sin datos</div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const stepX = width / (data.length - 1);
  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - ((d - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Detectar trend si no se pasó
  const calculatedTrend = trend ?? (data[data.length - 1] >= data[0] ? "up" : "down");
  const colorClass =
    calculatedTrend === "up"
      ? "stroke-primary"
      : calculatedTrend === "down"
        ? "stroke-destructive"
        : "stroke-muted-foreground";

  // Área bajo la curva
  const area = `0,${height} ${points} ${width},${height}`;

  const fillClass =
    calculatedTrend === "up"
      ? "fill-primary/10"
      : calculatedTrend === "down"
        ? "fill-destructive/10"
        : "fill-muted-foreground/10";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <polygon points={area} className={fillClass} stroke="none" />
      <polyline
        points={points}
        className={colorClass}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
