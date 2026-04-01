import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, MapPin, Train, Maximize2, ArrowUpDown, ExternalLink,
  Building2, Layers, Map, Clock, Eye, MessageSquare, LoaderCircle, ArrowUpNarrowWide,
} from "lucide-react";
import { toast } from "sonner";

type Platform = "cian" | "avito" | "yandex";
type Status = "new" | "interesting" | "not_interesting";
type SortBy = "score_desc" | "score_asc" | "date_desc" | "date_asc" | "price_asc" | "price_desc";

const PLATFORM_LABELS: Record<Platform, string> = { cian: "ЦИАН", avito: "Авито", yandex: "Яндекс" };
const PLATFORM_COLORS: Record<Platform, string> = { cian: "badge-cian", avito: "badge-avito", yandex: "badge-yandex" };
const SORT_LABELS: Record<SortBy, string> = {
  score_desc: "По оценке ↓", score_asc: "По оценке ↑",
  date_desc: "Сначала новые", date_asc: "Сначала старые",
  price_asc: "По цене ↑", price_desc: "По цене ↓",
};

interface ListingItem {
  id: number; platform: Platform; platformId: string;
  title: string | null; address: string | null; district: string | null;
  metroStation: string | null; metroDistanceMin: number | null;
  price: number | null; area: number | null; floor: number | null;
  totalFloors: number | null; ceilingHeight: number | null;
  photos: unknown; url: string; isNew: boolean;
  score: number | null; status: Status | null;
  comment: string | null; description: string | null;
  firstSeen: string | Date | null;
  lastSeen: string | Date | null;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  if (hours < 24) return `${hours} ч назад`;
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function getScoreBreakdown(n: ListingItem) {
  const r: { label: string; pts: number; max: number; icon: string }[] = [];
  if (n.floor == null) r.push({ label: "Этаж не указан", pts: 8, max: 30, icon: "🏢" });
  else if (n.floor === 1) r.push({ label: "1-й этаж — идеально", pts: 30, max: 30, icon: "🏢" });
  else if (n.floor === 2) r.push({ label: "2-й этаж", pts: 12, max: 30, icon: "🏢" });
  else if (n.floor === 3) r.push({ label: "3-й этаж", pts: 4, max: 30, icon: "🏢" });
  else r.push({ label: `${n.floor}-й этаж`, pts: 0, max: 30, icon: "🏢" });
  const entranceKws = ["отдельный вход","собственный вход","свой вход","вход с улицы","вход со двора","отдельный выход"];
  const haystack = `${n.title ?? ""} ${n.description ?? ""}`.toLowerCase();
  if (entranceKws.some((kw) => haystack.includes(kw))) r.push({ label: "Отдельный вход — есть", pts: 15, max: 15, icon: "🚪" });
  else if (haystack.includes("вход")) r.push({ label: "Вход упоминается", pts: 3, max: 15, icon: "🚪" });
  else r.push({ label: "Отд. вход не указан", pts: 0, max: 15, icon: "🚪" });
  if (n.ceilingHeight == null) r.push({ label: "Потолок не указан", pts: 12, max: 35, icon: "↕️" });
  else {
    const h = n.ceilingHeight / 100;
    if (h >= 3.5) r.push({ label: `Потолок ${h.toFixed(1)} м — идеально`, pts: 35, max: 35, icon: "↕️" });
    else if (h >= 3) r.push({ label: `Потолок ${h.toFixed(1)} м`, pts: 21, max: 35, icon: "↕️" });
    else if (h >= 2.7) r.push({ label: `Потолок ${h.toFixed(1)} м`, pts: 9, max: 35, icon: "↕️" });
    else r.push({ label: `Потолок ${h.toFixed(1)} м — низко`, pts: 0, max: 35, icon: "↕️" });
  }
  if (n.area == null) r.push({ label: "Площадь не указана", pts: 5, max: 20, icon: "📐" });
  else {
    const a = n.area;
    if (a < 25) r.push({ label: `${a} м² — слишком мало`, pts: -50, max: 20, icon: "📐" });
    else if (a <= 30) r.push({ label: `${a} м² — маловато`, pts: 10, max: 20, icon: "📐" });
    else if (a <= 60) r.push({ label: `${a} м² — идеально`, pts: 20, max: 20, icon: "📐" });
    else if (a <= 70) r.push({ label: `${a} м² — немного много`, pts: 10, max: 20, icon: "📐" });
    else r.push({ label: `${a} м² — слишком много`, pts: 0, max: 20, icon: "📐" });
  }
  return r;
}

function ListingCard({ listing, onStatusChange }: { listing: ListingItem; onStatusChange: (id: number, status: Status) => void }) {
  const [showScore, setShowScore] = useState(false);
  const scoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showScore) return;
    const handler = (e: MouseEvent) => { if (scoreRef.current && !scoreRef.current.contains(e.target as Node)) setShowScore(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showScore]);
  const platform = listing.platform;
  const photos = Array.isArray(listing.photos) ? (listing.photos as string[]) : [];
  const price = listing.price ? Number(listing.price).toLocaleString("ru-RU") : null;
  const isNew = listing.isNew;
  const status = listing.status ?? "new";
  const score = listing.score ?? 0;
  const scoreColor = score >= 80 ? "bg-green-500/15 text-green-400 border-green-500/30" : score >= 50 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" : score >= 25 ? "bg-orange-500/15 text-orange-400 border-orange-500/30" : "bg-muted text-muted-foreground border-border";
  const scoreIcon = score >= 80 ? "★" : score >= 50 ? "◐" : "○";
  return (
    <div className="listing-card bg-card rounded-2xl overflow-hidden border border-border mb-3">
      {photos.length > 0 && (
        <div className="relative h-44 overflow-hidden bg-muted">
          <img src={photos[0]} alt={listing.title ?? "Офис"} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          {isNew && <div className="absolute top-2 left-2"><span className="new-badge bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">НОВОЕ</span></div>}
          <div className="absolute top-2 right-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${PLATFORM_COLORS[platform]}`}>{PLATFORM_LABELS[platform]}</span></div>
        </div>
      )}
      <div className="p-4">
        {photos.length === 0 && (
          <div className="flex items-center justify-between mb-3">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${PLATFORM_COLORS[platform]}`}>{PLATFORM_LABELS[platform]}</span>
            {isNew && <span className="new-badge bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">НОВОЕ</span>}
          </div>
        )}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            {price ? <div className="text-xl font-bold text-foreground">{price} <span className="text-sm font-normal text-muted-foreground">₽/мес</span></div> : <div className="text-sm text-muted-foreground">Цена не указана</div>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="relative" ref={scoreRef}>
              <button onClick={(e) => { e.stopPropagation(); setShowScore((v) => !v); }} className={`flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full border cursor-pointer hover:opacity-80 ${scoreColor}`}>
                {scoreIcon}<span>{score}</span>
              </button>
              {showScore && (() => {
                const bd = getScoreBreakdown(listing);
                return (
                  <div className="absolute right-0 top-7 z-50 w-56 rounded-xl border border-border shadow-xl overflow-hidden" style={{ background: "oklch(0.18 0.02 250)" }}>
                    <div className="px-3 py-2 border-b border-border"><span className="text-xs font-semibold text-foreground">Оценка: {score}</span></div>
                    {bd.map((item, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 last:border-0">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><span>{item.icon}</span><span>{item.label}</span></span>
                        <span className={`text-xs font-semibold ${item.pts > 0 ? "text-green-400" : item.pts < 0 ? "text-red-400" : "text-muted-foreground"}`}>{item.pts > 0 ? "+" : ""}{item.pts}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {listing.area && <div className="flex items-center gap-1 text-foreground font-semibold text-sm"><Maximize2 size={13} className="text-primary" /><span>{listing.area} м²</span></div>}
            {listing.ceilingHeight && <div className="flex items-center gap-1 text-muted-foreground text-xs"><ArrowUpDown size={11} /><span>потолок {(listing.ceilingHeight / 100).toFixed(1)} м</span></div>}
            {listing.floor != null && <div className="flex items-center gap-1 text-muted-foreground text-xs"><Layers size={11} /><span>{listing.floor}-й эт.{listing.totalFloors ? ` из ${listing.totalFloors}` : ""}</span></div>}
          </div>
        </div>
        {listing.address && <div className="flex items-start gap-1.5 mb-2"><MapPin size={13} className="text-muted-foreground mt-0.5 shrink-0" /><span className="text-sm text-foreground/80 leading-tight">{listing.address}</span></div>}
        {listing.district && <div className="flex items-center gap-1.5 mb-2"><Map size={12} className="text-primary/70 shrink-0" /><span className="text-xs font-medium text-primary/80 bg-primary/10 px-2 py-0.5 rounded-full">{listing.district} р-н</span></div>}
        {listing.metroStation && <div className="flex items-center gap-1.5 mb-3"><Train size={13} className="text-primary shrink-0" /><span className="text-sm text-foreground/80">{listing.metroStation}{listing.metroDistanceMin && <span className="text-muted-foreground"> — {listing.metroDistanceMin} мин пешком</span>}</span></div>}
        <a href={listing.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors mb-2">
          <ExternalLink size={14} />Открыть объявление
        </a>
        {listing.comment && <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-xl bg-muted/50 border border-border"><MessageSquare size={13} className="text-muted-foreground mt-0.5 shrink-0" /><p className="text-xs text-muted-foreground italic leading-relaxed">{listing.comment}</p></div>}
        <div className="flex items-center gap-3 mb-3 text-[10px] text-muted-foreground/60">
          {listing.firstSeen && <span className="flex items-center gap-1"><Clock size={9} />добавлено {formatDate(listing.firstSeen)}</span>}
          {listing.lastSeen && listing.firstSeen && new Date(listing.lastSeen).getTime() - new Date(listing.firstSeen).getTime() > 60000 && <span className="flex items-center gap-1">· обновлено {formatDate(listing.lastSeen)}</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => onStatusChange(listing.id, status === "not_interesting" ? "new" : "not_interesting")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors border ${status === "not_interesting" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted"}`}>
            <Eye size={12} />Неинтересно
          </button>
          <button onClick={() => onStatusChange(listing.id, status === "interesting" ? "new" : "interesting")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors border ${status === "interesting" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted"}`}>
            <MessageSquare size={12} />Интересно
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
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortBy>("score_desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [minCeilingHeight, setMinCeilingHeight] = useState<number | undefined>(undefined);
  const [areaIdeal, setAreaIdeal] = useState<boolean | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const LIMIT = 15;

  useEffect(() => {
    if (!showSortMenu) return;
    const handler = (e: MouseEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSortMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSortMenu]);

  const utils = trpc.useUtils();

  const updateStatusMutation = trpc.listings.updateStatus.useMutation({
    onMutate: async ({ id, status: newStatus }) => {
      await utils.listings.list.cancel();
      const prev = utils.listings.list.getData({ platform, status, sortBy, minCeilingHeight, areaIdeal, limit: LIMIT, offset });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      utils.listings.list.setData({ platform, status, sortBy, minCeilingHeight, areaIdeal, limit: LIMIT, offset }, (old: any) => old && { ...old, items: old.items.map((d: ListingItem) => d.id === id ? { ...d, status: newStatus } : d) });
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) utils.listings.list.setData({ platform, status, sortBy, minCeilingHeight, areaIdeal, limit: LIMIT, offset }, ctx.prev); },
    onSettled: () => utils.listings.list.invalidate(),
  });

  const { data, isLoading, refetch } = trpc.listings.list.useQuery(
    { platform, status, sortBy, minCeilingHeight, areaIdeal, limit: LIMIT, offset },
    { refetchInterval: 120000 }
  );

  useEffect(() => {
    if (data) setLastUpdated(new Date());
  }, [data]);

  const { data: stats } = trpc.listings.stats.useQuery(undefined, { refetchInterval: 60000 });

  const { data: progress } = trpc.scraper.progress.useQuery(undefined, {
    refetchInterval: (q) => q.state.data?.isRunning || manualRefreshing ? 1500 : false,
    refetchIntervalInBackground: true,
  });

  const triggerMutation = trpc.scraper.triggerAll.useMutation({
    onMutate: () => setManualRefreshing(true),
    onSuccess: (res) => {
      toast.success(`Готово! Найдено: ${res.found}, новых: ${res.newCount}`);
      refetch();
      utils.listings.stats.invalidate();
      utils.listings.list.invalidate();
      utils.scraper.progress.invalidate();
      setManualRefreshing(false);
    },
    onError: () => { toast.error("Ошибка при запуске парсера"); setManualRefreshing(false); },
  });

  const handleStatusChange = (id: number, newStatus: Status) => { updateStatusMutation.mutate({ id, status: newStatus }); };
  const listings = (data?.items ?? []) as ListingItem[];
  const total = data?.total ?? 0;
  const combinedStats = data ? { total: data.total, cian: data.cian, avito: data.avito, yandex: data.yandex } : null;
  const displayStats = combinedStats ?? stats;
  const isScrapingActive = progress?.isRunning || manualRefreshing;

  return (
    <div className="pb-24">
      <div className="sticky top-0 z-40 border-b border-border px-4 py-3" style={{ background: "oklch(0.16 0.02 250 / 0.95)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <Building2 size={20} className="text-primary" />
            <div>
              <span className="font-semibold text-foreground">Офисы СПб</span>
              {displayStats && <span className="text-xs text-muted-foreground ml-2">{displayStats.total} объявл.</span>}
              {lastUpdated && !progress?.isRunning && <div className="text-[10px] text-muted-foreground/50 mt-0.5">обновлено {formatDate(lastUpdated)}</div>}
              {progress?.isRunning && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {(["cian", "yandex", "avito"] as Platform[]).map((p) => {
                    const ps = progress.platforms[p];
                    if (ps.status === "skipped") return null;
                    return (
                      <span key={p} className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5 ${ps.status === "running" ? "bg-primary/20 text-primary animate-pulse" : ps.status === "done" ? "bg-green-500/20 text-green-400" : ps.status === "error" ? "bg-red-500/20 text-red-400" : "bg-muted text-muted-foreground"}`}>
                        {ps.status === "running" && <LoaderCircle size={8} className="animate-spin" />}
                        {ps.status === "done" && <span>✓</span>}
                        {ps.status === "error" && <span>✗</span>}
                        {PLATFORM_LABELS[p]}
                        {ps.status === "done" && ps.found > 0 && <span className="opacity-70">·{ps.found}</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending || isScrapingActive} className="h-8 px-3 text-xs gap-1.5">
            <RefreshCw size={13} className={isScrapingActive ? "animate-spin" : ""} />
            {isScrapingActive ? "Поиск..." : "Обновить"}
          </Button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4">
        {displayStats && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: "Всего", value: displayStats.total, color: "text-foreground" },
              { label: "ЦИАН", value: displayStats.cian, color: "text-[oklch(0.75_0.2_220)]" },
              { label: "Авито", value: displayStats.avito, color: "text-[oklch(0.75_0.2_145)]" },
              { label: "Яндекс", value: displayStats.yandex, color: "text-[oklch(0.8_0.22_25)]" },
            ].map((s) => (
              <div key={s.label} className="bg-card rounded-xl p-2.5 text-center border border-border">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          <button onClick={() => { setStatus(undefined); setOffset(0); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${status === undefined ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}><Layers size={11} /> Все</button>
          <button onClick={() => { setStatus("new"); setOffset(0); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${status === "new" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}><Clock size={11} /> Очередь</button>
          <button onClick={() => { setStatus("interesting"); setOffset(0); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${status === "interesting" ? "bg-amber-500 text-white border-amber-500" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}><MessageSquare size={11} /> Интересные</button>
          <button onClick={() => { setStatus("not_interesting"); setOffset(0); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${status === "not_interesting" ? "bg-emerald-600 text-white border-emerald-600" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}><Eye size={11} /> Неинтересные</button>
        </div>

        <div className="relative mb-3" ref={sortRef}>
          <button onClick={() => setShowSortMenu((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
            <ArrowUpNarrowWide size={11} />{SORT_LABELS[sortBy]}
          </button>
          {showSortMenu && (
            <div className="absolute left-0 top-9 z-50 rounded-xl border border-border shadow-xl overflow-hidden" style={{ background: "oklch(0.18 0.02 250)", minWidth: "160px" }}>
              {(Object.entries(SORT_LABELS) as [SortBy, string][]).map(([key, label]) => (
                <button key={key} onClick={() => { setSortBy(key); setOffset(0); setShowSortMenu(false); }} className={`w-full text-left px-4 py-2.5 text-xs transition-colors hover:bg-white/5 ${sortBy === key ? "text-primary font-semibold" : "text-foreground/80"}`}>{label}</button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          <button onClick={() => { setMinCeilingHeight(undefined); setOffset(0); }} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${minCeilingHeight === undefined ? "bg-muted text-foreground border-border" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>↕ Все потолки</button>
          <button onClick={() => { setMinCeilingHeight(270); setOffset(0); }} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${minCeilingHeight === 270 ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>↕ ≥ 2.7 м</button>
          <button onClick={() => { setMinCeilingHeight(300); setOffset(0); }} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${minCeilingHeight === 300 ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>↕ ≥ 3 м</button>
          <button onClick={() => { setAreaIdeal(!areaIdeal); setOffset(0); }} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${areaIdeal ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>📐 30–60 м²</button>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button onClick={() => { setPlatform(undefined); setOffset(0); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${!platform ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}><Layers size={11} /> Все площадки</button>
          {(["cian", "avito", "yandex"] as Platform[]).map((p) => (
            <button key={p} onClick={() => { setPlatform(platform === p ? undefined : p); setOffset(0); }} className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${platform === p ? `${PLATFORM_COLORS[p]} border-current` : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>{PLATFORM_LABELS[p]}</button>
          ))}
        </div>

        {isLoading ? (
          <><ListingSkeleton /><ListingSkeleton /><ListingSkeleton /></>
        ) : listings.length === 0 ? (
          <div className="text-center py-16">
            <Building2 size={48} className="text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="text-muted-foreground font-medium">Объявлений пока нет</p>
            <p className="text-sm text-muted-foreground/60 mt-1 mb-6">Нажмите «Обновить» для поиска объявлений</p>
            <Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending || isScrapingActive} className="gap-2">
              <RefreshCw size={15} className={isScrapingActive ? "animate-spin" : ""} />
              {isScrapingActive ? "Идёт поиск..." : "Найти объявления"}
            </Button>
          </div>
        ) : (
          <>
            {listings.map((listing) => (
              <ListingCard key={`${listing.platform}-${listing.platformId}`} listing={listing} onStatusChange={handleStatusChange} />
            ))}
            <div className="flex items-center justify-between py-4">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Назад</Button>
              <span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + LIMIT, total)} из {total}</span>
              <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Далее →</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
