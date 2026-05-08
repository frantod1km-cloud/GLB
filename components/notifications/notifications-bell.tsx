"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  markNotificationReadAction,
  markAllReadAction,
  deleteNotificationAction,
} from "@/app/actions/notifications";

interface NotificationsBellProps {
  userId: string;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell({ userId }: NotificationsBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // Cargar últimas 20 + suscribirse a realtime
  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setNotifications(data || []);
    }
    load();

    const channel = supabase
      .channel(`notifications-${userId}`)
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
            setNotifications((prev) => [payload.new, ...prev].slice(0, 20));
          } else if (payload.eventType === "UPDATE") {
            setNotifications((prev) =>
              prev.map((n) => (n.id === payload.new.id ? payload.new : n))
            );
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markNotificationReadAction(id);
      // El realtime UPDATE se encarga de actualizar el state
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllReadAction();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteNotificationAction(id);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-md hover:bg-secondary/50 transition-colors"
          aria-label="Notificaciones"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            <span className="font-semibold text-sm">Notificaciones</span>
            {unreadCount > 0 && (
              <span className="text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 py-0 font-medium">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              title="Marcar todas como leídas"
            >
              <CheckCheck className="w-3 h-3" />
              Marcar todas
            </button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No tenés notificaciones
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={handleMarkRead}
                  onDelete={handleDelete}
                  disabled={isPending}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-2 border-t border-border/40 text-center">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
  disabled,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  disabled: boolean;
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

  const timeAgo = formatTimeAgo(new Date(notification.created_at));

  return (
    <div
      className={`group p-3 hover:bg-muted/30 transition-colors relative ${
        isUnread ? "bg-primary/5" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${typeColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-sm leading-tight">{notification.title}</div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {timeAgo}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
            {notification.message}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {isUnread && (
          <button
            onClick={() => onMarkRead(notification.id)}
            disabled={disabled}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            <Check className="w-2.5 h-2.5" />
            Leído
          </button>
        )}
        <button
          onClick={() => onDelete(notification.id)}
          disabled={disabled}
          className="text-[10px] text-destructive hover:underline flex items-center gap-0.5 ml-auto"
        >
          <X className="w-2.5 h-2.5" />
          Eliminar
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "ahora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}
