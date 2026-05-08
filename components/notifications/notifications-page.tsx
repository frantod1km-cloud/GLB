"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read_at: string | null;
  created_at: string;
}

type FilterMode = "all" | "unread" | "read";

export default function NotificationsClientPage({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200);
      setNotifications(data || []);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`notifications-page-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (payload.eventType === "INSERT") {
            setNotifications((prev) => [payload.new, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setNotifications((prev) =>
              prev.map((n) => (n.id === payload.new.id ? payload.new : n))
            );
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) =>
              prev.filter((n) => n.id !== payload.old.id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const filtered = notifications.filter((n) => {
    if (filter === "unread") return !n.read_at;
    if (filter === "read") return !!n.read_at;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const readCount = notifications.filter((n) => !!n.read_at).length;

  async function handleMarkRead(id: string) {
    const supabase = createClient();
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  async function handleMarkAllRead() {
    const supabase = createClient();
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at || now }))
    );
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) {
      console.error("Error deleting:", error);
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200);
      setNotifications(data || []);
    }
  }

  async function handleClearRead() {
    if (!confirm(`¿Eliminar las ${readCount} notificaciones leídas?`)) return;
    const supabase = createClient();
    setNotifications((prev) => prev.filter((n) => !n.read_at));
    await supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId)
      .not("read_at", "is", null);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver al dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-2">
          <Bell className="w-6 h-6" />
          Notificaciones
        </h1>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1">
          {(["all", "unread", "read"] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {f === "all" && "Todas"}
              {f === "unread" && `Sin leer (${unreadCount})`}
              {f === "read" && `Leídas (${readCount})`}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleMarkAllRead}>
              <CheckCheck className="w-4 h-4" />
              Marcar todas como leídas
            </Button>
          )}
          {readCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleClearRead}>
              <Trash2 className="w-4 h-4" />
              Borrar leídas
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm text-muted-foreground">
            {filter === "all" && "No tenés notificaciones todavía"}
            {filter === "unread" && "Todo al día, no hay notificaciones sin leer"}
            {filter === "read" && "No hay notificaciones leídas"}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
          <div className="divide-y divide-border/40">
            {filtered.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onMarkRead={handleMarkRead}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isUnread = !notification.read_at;
  const typeColor =
    notification.type === "success"
      ? "bg-primary"
      : notification.type === "error"
        ? "bg-destructive"
        : notification.type === "warning"
          ? "bg-yellow-500"
          : "bg-blue-500";

  return (
    <div
      className={`p-4 hover:bg-muted/20 transition-colors flex items-start gap-3 ${
        isUnread ? "bg-primary/5" : ""
      }`}
    >
      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${typeColor}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{notification.title}</span>
            {isUnread && <Badge variant="default">Nueva</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(notification.created_at).toLocaleString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="text-sm text-muted-foreground mt-1">{notification.message}</div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {isUnread && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMarkRead(notification.id)}
            title="Marcar como leída"
          >
            <Check className="w-4 h-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onDelete(notification.id)}
          title="Eliminar"
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
