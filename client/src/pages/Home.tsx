import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  MapPin,
  Train,
  Maximize2,
  ExternalLink,
  Building2,
  Filter,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

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

interface ListingItem {
  id: number;
  platform: Platform;
  platformId: string;
  title: string | null;
  address: string | null;
  metroStation: string | null;
  metroDistanceMin: number | null;
  price: number | null;
  area: number | null;
  floor: number | null;
  totalFloors: number | null;
  photos: unknown;
  url: string;
  isNew: boolean;
}

function ListingCard({ listing }: { listing: ListingItem }) {
  const platform = listing.platform;
  const photos = Array.isArray(listing.photos) ? (listing.photos as string[]) : [];
  const price = listing.price ? Number(listing.price).toLocaleString("ru-RU") : null;
  const isNew = listing.isNew;

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
          {listing.area && (
            <div className="flex items-center gap-1 text-muted-foreground text-sm shrink-0">
              <Maximize2 size={13} />
              <span>{listing.area} м²</span>
            </div>
          )}
        </div>

        {listing.address && (
          <div className="flex items-start gap-1.5 mb-2">
            <MapPin size={13} className="text-muted-foreground mt-0.5 shrink-0" />
            <span className="text-sm text-foreground/80 leading-tight">{listing.address}</span>
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

        {listing.floor && (
          <div className="text-xs text-muted-foreground mb-3">
            {listing.floor} этаж{listing.totalFloors ? ` из ${listing.totalFloors}` : ""}
          </div>
        )}

        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          <ExternalLink size={14} />
          Открыть объявление
        </a>
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
  const [showNewOnly, setShowNewOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 15;

  const { data, isLoading, refetch } = trpc.listings.list.useQuery(
    { platform, isNew: showNewOnly ? true : undefined, limit: LIMIT, offset },
    { refetchInterval: 120000 }
  );
  const { data: stats } = trpc.listings.stats.useQuery(undefined, { refetchInterval: 60000 });

  const triggerMutation = trpc.scraper.triggerAll.useMutation({
    onSuccess: (res) => {
      toast.success(`Готово! Найдено: ${res.found}, новых: ${res.newCount}`);
      refetch();
    },
    onError: () => toast.error("Ошибка при запуске парсера"),
  });

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
            <span className="font-semibold text-foreground">Офисы СПб</span>
            {stats && (
              <span className="text-xs text-muted-foreground">{stats.total} объявл.</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="h-8 px-3 text-xs gap-1.5"
          >
            <RefreshCw size={13} className={triggerMutation.isPending ? "animate-spin" : ""} />
            {triggerMutation.isPending ? "Поиск..." : "Обновить"}
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

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => { setPlatform(undefined); setOffset(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              !platform && !showNewOnly
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Layers size={11} /> Все
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
          <button
            onClick={() => { setShowNewOnly(!showNewOnly); setOffset(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              showNewOnly
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Filter size={11} /> Новые
          </button>
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
              <ListingCard key={`${listing.platform}-${listing.platformId}`} listing={listing} />
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
