import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";

const PLATFORM_LABELS: Record<string, string> = {
  cian: "ЦИАН",
  avito: "Авито",
  yandex: "Яндекс",
  all: "Все площадки",
};

function formatDuration(start: Date | string, end: Date | string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}мс`;
  return `${(ms / 1000).toFixed(1)}с`;
}

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LogsPage() {
  const { data: logs, isLoading, refetch } = trpc.scraper.getLogs.useQuery({ limit: 30 });
  const { data: stats } = trpc.listings.stats.useQuery();

  const triggerMutation = trpc.scraper.triggerAll.useMutation({
    onSuccess: (res) => {
      toast.success(`Готово! Найдено: ${res.found}, новых: ${res.newCount}`);
      refetch();
    },
    onError: () => toast.error("Ошибка при запуске"),
  });

  const triggerPlatformMutation = trpc.scraper.triggerPlatform.useMutation({
    onSuccess: (res) => {
      toast.success(`${PLATFORM_LABELS[res.platform]}: найдено ${res.found}, новых ${res.newCount}`);
      refetch();
    },
    onError: () => toast.error("Ошибка"),
  });

  return (
    <div className="pb-24">
      {/* Header */}
      <div
        className="sticky top-0 z-40 border-b border-border px-4 py-3"
        style={{ background: "oklch(0.16 0.02 250 / 0.95)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-primary" />
            <span className="font-semibold text-foreground">Мониторинг</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            className="h-8 px-3 text-xs gap-1.5"
          >
            <RefreshCw size={12} />
            Обновить
          </Button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Stats */}
        {stats && (
          <div className="bg-card rounded-2xl p-4 border border-border">
            <p className="text-xs font-medium text-muted-foreground mb-3">Статистика базы</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded-xl p-3">
                <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Всего объявлений</div>
              </div>
              <div className="bg-background rounded-xl p-3">
                <div className="text-2xl font-bold text-primary">{stats.newCount}</div>
                <div className="text-xs text-muted-foreground">Новых (несмотренных)</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { label: "ЦИАН", value: stats.cian, color: "text-[oklch(0.75_0.2_220)]" },
                { label: "Авито", value: stats.avito, color: "text-[oklch(0.75_0.2_145)]" },
                { label: "Яндекс", value: stats.yandex, color: "text-[oklch(0.8_0.22_25)]" },
              ].map((s) => (
                <div key={s.label} className="bg-background rounded-xl p-2.5 text-center">
                  <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual trigger */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <p className="text-xs font-medium text-muted-foreground mb-3">Ручной запуск</p>
          <Button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="w-full h-11 gap-2 mb-3"
          >
            {triggerMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            {triggerMutation.isPending ? "Идёт поиск..." : "Запустить все площадки"}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            {(["cian", "avito", "yandex"] as const).map((p) => (
              <Button
                key={p}
                variant="outline"
                size="sm"
                onClick={() => triggerPlatformMutation.mutate({ platform: p })}
                disabled={triggerPlatformMutation.isPending}
                className="text-xs h-9"
              >
                {PLATFORM_LABELS[p]}
              </Button>
            ))}
          </div>
        </div>

        {/* Schedule info */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-primary" />
            <span className="text-sm font-medium text-foreground">Автоматический мониторинг</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Парсер запускается автоматически каждые <strong className="text-foreground">30 минут</strong>.
            Новые объявления отправляются в Telegram сразу после обнаружения.
          </p>
        </div>

        {/* Logs */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-3">История запусков</p>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Загрузка...</div>
          ) : !logs || logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Запусков ещё не было
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-card rounded-xl p-3 border border-border flex items-start gap-3"
                >
                  <div className="mt-0.5 shrink-0">
                    {log.status === "success" && (
                      <CheckCircle2 size={16} className="text-green-400" />
                    )}
                    {log.status === "error" && (
                      <XCircle size={16} className="text-destructive" />
                    )}
                    {log.status === "running" && (
                      <Loader2 size={16} className="text-primary animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {PLATFORM_LABELS[log.platform] ?? log.platform}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatTime(log.startedAt)}
                      </span>
                    </div>
                    {log.status === "success" && (
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Найдено: <strong className="text-foreground">{log.found}</strong></span>
                        <span>Новых: <strong className="text-primary">{log.newCount}</strong></span>
                        <span>Время: {formatDuration(log.startedAt, log.finishedAt ?? null)}</span>
                      </div>
                    )}
                    {log.status === "error" && log.errorMessage && (
                      <p className="text-xs text-destructive mt-1 truncate">{log.errorMessage}</p>
                    )}
                    {log.status === "running" && (
                      <p className="text-xs text-muted-foreground mt-1">Выполняется...</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
