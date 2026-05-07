import { Badge } from "@/components/ui/badge";
import { Clock, Check, X, AlertCircle } from "lucide-react";

export function TransactionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
    case "approved":
      return (
        <Badge variant="success">
          <Check className="w-3 h-3" />
          Aprobado
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="destructive">
          <X className="w-3 h-3" />
          Rechazado
        </Badge>
      );
    case "in_review":
      return (
        <Badge variant="warning">
          <Clock className="w-3 h-3" />
          En revisión
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="secondary">
          <AlertCircle className="w-3 h-3" />
          Pendiente
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function formatRelativeTime(date: string | Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  const diff = d.getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const sign = diff < 0 ? "hace " : "en ";
  const suffix = "";

  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(absDiff / 3600000);
  const days = Math.floor(absDiff / 86400000);

  if (minutes < 1) return diff < 0 ? "ahora" : "ya";
  if (minutes < 60) return `${sign}${minutes}m${suffix}`;
  if (hours < 24) return `${sign}${hours}h${suffix}`;
  return `${sign}${days}d${suffix}`;
}
