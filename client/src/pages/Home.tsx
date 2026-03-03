import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  MapPin,
  Train,
  Maximize2,
  ArrowUpDown,
  ExternalLink,
  Building2,
  Filter,
  Layers,
  Map,
  Eye,
  Star,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useState as useStateLocal, useRef, useEffect } from "react";

type Platform = "cian" | "avito" | "yandex";

const PLATFORM_LABELS: Record<Platform, string> = {
  cian: "ЦИАН",
  avito: "Авито",
  yandex: "Яндекс",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  cian: "badge-cian",
  avito: "badge-avito",
  yandex: "badge-yandex",
};

type ListingStatus = "new" | "not_interesting" | "interesting";

interface ListingItem {
  id: number;
  platform: Platform;
  platformId: string;
  title: string | null;
  address: string | null;
  district: string | null;
  metroStation: string | null;
  metroDistanceMin: number | null;
  price: number | null;
  area: number | null;
  floor: number | null;
  totalFloors: number | null;
  ceilingHeight: number | null;
  photos: unknown;
  url: string;
  isNew: boolean;
  status: ListingStatus;
  createdAt: Date | string | null;
  score: number;
}

// Compute score breakdown on the frontend (mirrors server/utils/scoreListing.ts)
function computeScoreBreakdown(listing: ListingItem): { label: string; pts: number; max: number; icon: string }[] {
  const breakdown: { label: string; pts: number; max: number; icon: string }[] = [];

  // Floor
  if (listing.floor == null) {
    breakdown.push({ label: "Этаж не указан", pts: 10, max: 35, icon: "🏢" });
  } else if (listing.floor === 1) {
    breakdown.push({ label: "1-й этаж — идеально", pts: 35, max: 35, icon: "🏢" });
  } else if (listing.floor === 2) {
    breakdown.push({ label: `2-й этаж`, pts: 15, max: 35, icon: "🏢" });
  } else if (listing.floor === 3) {
    breakdown.push({ label: `3-й этаж`, pts: 5, max: 35, icon: "🏢" });
  } else {
    breakdown.push({ label: `${listing.floor}-й этаж`, pts: 0, max: 35, icon: "🏢" });
  }

  // Entrance
  const ENTRANCE_KW = ["отдельный вход", "собственный вход", "свой вход", "вход с улицы", "вход со двора", "отдельный выход"];
  const haystack = `${listing.title ?? ""} ${(listing as any).description ?? ""}`.toLowerCase();
  const hasEntrance = ENTRANCE_KW.some((kw) => haystack.includes(kw));
  if (hasEntrance) {
    breakdown.push({ label: "Отдельный вход — есть", pts: 35, max: 35, icon: "🚪" });
  } else if (haystack.includes("вход")) {
    breakdown.push({ label: "Вход упоминается", pts: 5, max: 35, icon: "🚪" });
  } else {
    breakdown.push({ label: "Отд. вход не указан", pts: 0, max: 35, icon: "🚪" });
  }

  // Ceiling
  if (listing.ceilingHeight == null) {
    breakdown.push({ label: "Потолок не указан", pts: 10, max: 30, icon: "↕️" });
  } else {
    const h = listing.ceilingHeight / 100;
    if (h >= 3.5) breakdown.push({ label: `Потолок ${h.toFixed(1)} м — идеально`, pts: 30, max: 30, icon: "↕️" });
    else if (h >= 3.0) breakdown.push({ label: `Потолок ${h.toFixed(1)} м`, pts: 18, max: 30, icon: "↕️" });
    else if (h >= 2.7) breakdown.push({ label: `Потолок ${h.toFixed(1)} м`, pts: 8, max: 30, icon: "↕️" });
    else breakdown.push({ label: `Потолок ${h.toFixed(1)} м — низко`, pts: 0, max: 30, icon: "↕️" });
  }

  return breakdown;
}

function ListingCard({ listing, onStatusChange }: { listing: ListingItem; onStatusChange: (id: number, status: ListingStatus) => void }) {
  const [showBreakdown, setShowBreakdown] = useStateLocal(false);
  const breakdownRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showBreakdown) return;
    const handler = (e: MouseEvent) => {
      if (breakdownRef.current && !breakdownRef.current.contains(e.target as Node)) {
        setShowBreakdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBreakdown]);
  const platform = listing.platform;
  const photos = Array.isArray(listing.photos) ? (listing.photos as string[]) : [];
  const price = listing.price ? Number(listing.price).toLocaleString("ru-RU") : null;
  const isNew = listing.isNew;
  const status = listing.status ?? "new";

  return (
    <div className="listing-card bg-card rounded-2xl overflow-hidden border border-border mb-3">
      {photos.length > 0 && (
        <div className="relative h-44 overflow-hidden bg-muted">
          <img
            src={photos[0]}
            alt={listing.title ?? "Офис"}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          {isNew && (
            <div className="absolute top-2 left-2">
              <span className="new-badge bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                НОВОЕ
              </span>
            </div>
          )}
          <div className="absolute top-2 right-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${PLATFORM_COLORS[platform]}`}>
              {PLATFORM_LABELS[platform]}
            </span>
          </div>
        </div>
      )}

      <div className="p-4">
        {photos.length === 0 && (
          <div className="flex items-center justify-between mb-3">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${PLATFORM_COLORS[platform]}`}>
              {PLATFORM_LABELS[platform]}
            </span>
            {isNew && (
              <span className="new-badge bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                НОВОЕ
              </span>
            )}
          </div>
        )}

        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            {price ? (
              <div className="text-xl font-bold text-foreground">
                {price} <span className="text-sm font-normal text-muted-foreground">₽/мес</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Цена не указана</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {/* Score badge with breakdown popover */}
            <div className="relative" ref={breakdownRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowBreakdown((v) => !v); }}
                className={`flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full border cursor-pointer transition-opacity hover:opacity-80 ${
                  listing.score >= 80
                    ? "bg-green-500/15 text-green-400 border-green-500/30"
                    : listing.score >= 50
                    ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
                    : listing.score >= 25
                    ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {listing.score >= 80 ? "★" : listing.score >= 50 ? "◐" : "○"}
                <span>{listing.score}</span>
              </button>

              {showBreakdown && (() => {
                const bd = computeScoreBreakdown(listing);
                return (
                  <div
                    className="absolute right-0 top-7 z-50 w-56 rounded-xl border border-border shadow-xl p-3"
                    style={{ background: "oklch(0.18 0.02 250)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Расшифровка оценки</div>
                    <div className="space-y-2">
                      {bd.map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-base leading-none">{item.icon}</span>
                            <span className="text-xs text-foreground/80 truncate">{item.label}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-xs font-bold ${
                              item.pts === item.max ? "text-green-400" :
                              item.pts > 0 ? "text-yellow-400" : "text-muted-foreground"
                            }`}>
                              +{item.pts}
                            </span>
                            <span className="text-[10px] text-muted-foreground/50">/{item.max}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-border flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Итого</span>
                      <span className={`text-sm font-bold ${
                        listing.score >= 80 ? "text-green-400" :
                        listing.score >= 50 ? "text-yellow-400" :
                        listing.score >= 25 ? "text-orange-400" : "text-muted-foreground"
                      }`}>{listing.score}/100</span>
                    </div>
                  </div>
                );
              })()}
            </div>
            {listing.area && (
              <div className="flex items-center gap-1 text-foreground font-semibold text-sm">
                <Maximize2 size={13} className="text-primary" />
                <span>{listing.area} м²</span>
              </div>
            )}
            {listing.ceilingHeight && (
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <ArrowUpDown size={11} />
                <span>потолок {(listing.ceilingHeight / 100).toFixed(1)} м</span>
              </div>
            )}
            {listing.floor != null && (
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <Layers size={11} />
                <span>
                  {listing.floor}-й эт.{listing.totalFloors ? ` из ${listing.totalFloors}` : ""}
                </span>
              </div>
            )}
          </div>
        </div>

        {listing.address && (
          <div className="flex items-start gap-1.5 mb-2">
            <MapPin size={13} className="text-muted-foreground mt-0.5 shrink-0" />
            <span className="text-sm text-foreground/80 leading-tight">{listing.address}</span>
          </div>
        )}

        {listing.district && (
          <div className="flex items-center gap-1.5 mb-2">
            <Map size={12} className="text-primary/70 shrink-0" />
            <span className="text-xs font-medium text-primary/80 bg-primary/10 px-2 py-0.5 rounded-full">
              {listing.district} р-н
            </span>
          </div>
        )}

        {listing.metroStation && (
          <div className="flex items-center gap-1.5 mb-3">
            <Train size={13} className="text-primary shrink-0" />
            <span className="text-sm text-foreground/80">
              {listing.metroStation}
              {listing.metroDistanceMin && (
                <span className="text-muted-foreground"> — {listing.metroDistanceMin} мин пешком</span>
              )}
            </span>
          </div>
        )}

        {listing.createdAt && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 mb-3">
            <Clock size={10} />
            <span>Добавлено {new Date(listing.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}

        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors mb-2"
        >
          <ExternalLink size={14} />
          Открыть объявление
        </a>

        {/* Status action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onStatusChange(listing.id, status === "not_interesting" ? "new" : "not_interesting")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors border ${
              status === "not_interesting"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted"
            }`}
          >
            <Eye size={12} />
            {status === "not_interesting" ? "Неинтересно" : "Неинтересно"}
          </button>
          <button
            onClick={() => onStatusChange(listing.id, status === "interesting" ? "new" : "interesting")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors border ${
              status === "interesting"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted"
            }`}
          >
            <Star size={12} />
            {status === "interesting" ? "Интересно" : "Интересно"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListingSkeleton() {
  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border mb-3">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function Home() {
  const [platform, setPlatform] = useState<Platform | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<ListingStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [isScraping, setIsScraping] = useState(false);
  const LIMIT = 15;

  const utils = trpc.useUtils();

  const updateStatusMutation = trpc.listings.updateStatus.useMutation({
    onMutate: async ({ id, status }) => {
      // Optimistic update
      await utils.listings.list.cancel();
      const prev = utils.listings.list.getData({ platform, status: statusFilter, limit: LIMIT, offset });
      utils.listings.list.setData(
        { platform, status: statusFilter, limit: LIMIT, offset },
        (old) => old ? { ...old, items: old.items.map((item) => item.id === id ? { ...item, status } : item) } : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.listings.list.setData({ platform, status: statusFilter, limit: LIMIT, offset }, ctx.prev);
    },
    onSettled: () => utils.listings.list.invalidate(),
  });

  const { data, isLoading, refetch } = trpc.listings.list.useQuery(
    { platform, status: statusFilter, limit: LIMIT, offset },
    { refetchInterval: 120000 }
  );
  const { data: stats } = trpc.listings.stats.useQuery(undefined, { refetchInterval: 60000 });

  // Poll scrape progress while running
  const { data: progress } = trpc.scraper.progress.useQuery(undefined, {
    refetchInterval: (query) => {
      const data = query.state.data;
      return (data?.isRunning || isScraping) ? 1500 : false;
    },
    refetchIntervalInBackground: true,
  });

  const triggerMutation = trpc.scraper.triggerAll.useMutation({
    onMutate: () => setIsScraping(true),
    onSuccess: (res) => {
      toast.success(`Готово! Найдено: ${res.found}, новых: ${res.newCount}`);
      refetch();
      utils.listings.stats.invalidate();
      utils.scraper.progress.invalidate();
      setIsScraping(false);
    },
    onError: () => {
      toast.error("Ошибка при запуске парсера");
      setIsScraping(false);
    },
  });

  const handleStatusChange = (id: number, status: ListingStatus) => {
    updateStatusMutation.mutate({ id, status });
  };

  const listings = (data?.items ?? []) as ListingItem[];
  const total = data?.total ?? 0;

  return (
    <div className="pb-24">
      <div
        className="sticky top-0 z-40 border-b border-border px-4 py-3"
        style={{ background: "oklch(0.16 0.02 250 / 0.95)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <Building2 size={20} className="text-primary" />
            <div>
              <span className="font-semibold text-foreground">Офисы СПб</span>
              {stats && (
                <span className="text-xs text-muted-foreground ml-2">{stats.total} объявл.</span>
              )}
              {/* Progress indicator while scraping */}
              {progress?.isRunning ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {(["cian", "yandex", "avito"] as const).map((p) => {
                    const ps = progress.platforms[p];
                    if (ps.status === "skipped") return null;
                    const label = p === "cian" ? "ЦИАН" : p === "yandex" ? "Яндекс" : "Авито";
                    return (
                      <span
                        key={p}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                          ps.status === "running"
                            ? "bg-primary/20 text-primary animate-pulse"
                            : ps.status === "done"
                            ? "bg-green-500/20 text-green-400"
                            : ps.status === "error"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {ps.status === "running" && <RefreshCw size={8} className="animate-spin" />}
                        {ps.status === "done" && <span>✓</span>}
                        {ps.status === "error" && <span>✗</span>}
                        {label}
                        {ps.status === "done" && ps.found > 0 && (
                          <span className="opacity-70"> {ps.found}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : stats?.lastScrapeAt ? (
                <div className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                  <Clock size={9} />
                  <span>Обновлено {new Date(stats.lastScrapeAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ) : null}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending || progress?.isRunning}
            className="h-8 px-3 text-xs gap-1.5"
          >
            <RefreshCw size={13} className={(triggerMutation.isPending || progress?.isRunning) ? "animate-spin" : ""} />
            {(triggerMutation.isPending || progress?.isRunning) ? "Поиск..." : "Обновить"}
          </Button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4">
        {stats && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: "Всего", value: stats.total, color: "text-foreground" },
              { label: "ЦИАН", value: stats.cian, color: "text-[oklch(0.75_0.2_220)]" },
              { label: "Авито", value: stats.avito, color: "text-[oklch(0.75_0.2_145)]" },
              { label: "Яндекс", value: stats.yandex, color: "text-[oklch(0.8_0.22_25)]" },
            ].map((s) => (
              <div key={s.label} className="bg-card rounded-xl p-2.5 text-center border border-border">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Status tabs */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => { setStatusFilter(undefined); setOffset(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              statusFilter === undefined
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Layers size={11} /> Все
          </button>
          <button
            onClick={() => { setStatusFilter("new"); setOffset(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              statusFilter === "new"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Filter size={11} /> Новые
          </button>
          <button
            onClick={() => { setStatusFilter("interesting"); setOffset(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              statusFilter === "interesting"
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Star size={11} /> Интересные
          </button>
          <button
            onClick={() => { setStatusFilter("not_interesting"); setOffset(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              statusFilter === "not_interesting"
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Eye size={11} /> Неинтересные
          </button>
        </div>

        {/* Platform filter chips */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => { setPlatform(undefined); setOffset(0); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              !platform
                ? "bg-muted text-foreground border-border"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            Все площадки
          </button>
          {(["cian", "avito", "yandex"] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPlatform(platform === p ? undefined : p); setOffset(0); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                platform === p
                  ? `${PLATFORM_COLORS[p]} border-current`
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <>
            <ListingSkeleton />
            <ListingSkeleton />
            <ListingSkeleton />
          </>
        ) : listings.length === 0 ? (
          <div className="text-center py-16">
            <Building2 size={48} className="text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="text-muted-foreground font-medium">Объявлений пока нет</p>
            <p className="text-sm text-muted-foreground/60 mt-1 mb-6">
              Нажмите «Обновить» для поиска объявлений
            </p>
            <Button
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending}
              className="gap-2"
            >
              <RefreshCw size={15} className={triggerMutation.isPending ? "animate-spin" : ""} />
              {triggerMutation.isPending ? "Идёт поиск..." : "Найти объявления"}
            </Button>
          </div>
        ) : (
          <>
            {listings.map((listing) => (
              <ListingCard key={`${listing.platform}-${listing.platformId}`} listing={listing} onStatusChange={handleStatusChange} />
            ))}
            <div className="flex items-center justify-between py-4">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                ← Назад
              </Button>
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + LIMIT, total)} из {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset(offset + LIMIT)}
              >
                Далее →
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
