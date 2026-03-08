import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Settings2, MapPin, DollarSign, Maximize2, Train, Save, X, Plus,
  Building2, Layers, Search, ChevronDown, ChevronUp, Tag, Map, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// All SPb metro stations grouped by line
const METRO_LINES: { line: string; color: string; stations: string[] }[] = [
  {
    line: "1 (Кировско-Выборгская)",
    color: "#e42313",
    stations: [
      "Девяткино", "Гражданский проспект", "Академическая", "Политехническая",
      "Площадь Мужества", "Лесная", "Выборгская", "Площадь Ленина",
      "Чернышевская", "Площадь Восстания", "Владимирская", "Пушкинская",
      "Технологический институт", "Балтийская", "Нарвская", "Кировский завод",
      "Автово", "Ленинский проспект", "Проспект Ветеранов",
    ],
  },
  {
    line: "2 (Московско-Петроградская)",
    color: "#0078c8",
    stations: [
      "Парнас", "Проспект Просвещения", "Озерки", "Удельная", "Пионерская",
      "Чёрная речка", "Петроградская", "Горьковская", "Невский проспект",
      "Сенная площадь", "Технологический институт", "Фрунзенская",
      "Московские ворота", "Электросила", "Парк Победы", "Московская",
      "Звёздная", "Купчино",
    ],
  },
  {
    line: "3 (Невско-Василеостровская)",
    color: "#009a44",
    stations: [
      "Беговая", "Новокрестовская", "Приморская", "Василеостровская",
      "Гостиный двор", "Маяковская", "Площадь Александра Невского",
      "Елизаровская", "Ломоносовская", "Пролетарская", "Обухово",
      "Рыбацкое",
    ],
  },
  {
    line: "4 (Правобережная)",
    color: "#f07800",
    stations: [
      "Спасская", "Достоевская", "Лиговский проспект", "Площадь Александра Невского",
      "Новочеркасская", "Ладожская", "Проспект Большевиков", "Улица Дыбенко",
    ],
  },
  {
    line: "5 (Фрунзенско-Приморская)",
    color: "#9b59b6",
    stations: [
      "Комендантский проспект", "Старая Деревня", "Крестовский остров",
      "Чкаловская", "Спортивная", "Адмиралтейская", "Садовая",
      "Звенигородская", "Обводный канал", "Волковская", "Бухарестская",
      "Международная", "Проспект Славы", "Дунайская", "Шушары",
    ],
  },
];

const ALL_STATIONS = METRO_LINES.flatMap((l) => l.stations);

// All SPb districts
const SPB_DISTRICTS = [
  "Адмиралтейский",
  "Василеостровский",
  "Выборгский",
  "Калининский",
  "Кировский",
  "Колпинский",
  "Красногвардейский",
  "Красносельский",
  "Кронштадтский",
  "Курортный",
  "Московский",
  "Невский",
  "Петроградский",
  "Петродворцовый",
  "Приморский",
  "Пушкинский",
  "Фрунзенский",
  "Центральный",
];

const OFFICE_TYPES = [
  { value: "office", label: "Офис" },
  { value: "coworking", label: "Коворкинг" },
  { value: "free_purpose", label: "Свободного назначения" },
  { value: "all", label: "Все типы" },
];

function RangeInput({
  label, icon, minVal, maxVal, onMinChange, onMaxChange,
  min = 0, max = 999999, step = 1, unit = "",
}: {
  label: string; icon: React.ReactNode;
  minVal: number; maxVal: number;
  onMinChange: (v: number) => void; onMaxChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="bg-card rounded-2xl p-4 border border-border">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="font-medium text-foreground">{label}</span>
        {unit && <span className="text-xs text-muted-foreground ml-auto">{unit}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">От</Label>
          <Input
            type="number"
            value={minVal}
            onChange={(e) => onMinChange(Number(e.target.value))}
            className="bg-background border-border"
            min={min}
            max={maxVal}
            step={step}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">До</Label>
          <Input
            type="number"
            value={maxVal}
            onChange={(e) => onMaxChange(Number(e.target.value))}
            className="bg-background border-border"
            min={minVal}
            max={max}
            step={step}
          />
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const [, navigate] = useLocation();
  const [isScraping, setIsScraping] = useState(false);
  const utils = trpc.useUtils();

  const { data: config, refetch } = trpc.searchConfig.get.useQuery();

  // Poll scrape progress while running after save
  const { data: progress } = trpc.scraper.progress.useQuery(undefined, {
    refetchInterval: (query) => {
      const d = query.state.data;
      return (d?.isRunning || isScraping) ? 1500 : false;
    },
    refetchIntervalInBackground: true,
  });

  // When scraping finishes (started by us), navigate to Home
  const prevRunningRef = useRef<boolean>(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isRunning = progress?.isRunning ?? false;
    if (wasRunning && !isRunning && isScraping) {
      setIsScraping(false);
      utils.listings.list.invalidate();
      utils.listings.stats.invalidate();
      toast.success("Поиск завершён — выдача обновлена");
      navigate("/");
    }
    prevRunningRef.current = isRunning;
  }, [progress?.isRunning]);

  const triggerMutation = trpc.scraper.triggerAll.useMutation({
    onSuccess: () => {
      // scrape finished synchronously (rare), navigate immediately
      setIsScraping(false);
      utils.listings.list.invalidate();
      utils.listings.stats.invalidate();
      toast.success("Поиск завершён — выдача обновлена");
      navigate("/");
    },
    onError: () => {
      setIsScraping(false);
      toast.error("Ошибка при запуске парсера");
    },
  });

  const rescoreMutation = trpc.listings_rescore.all.useMutation({
    onSuccess: (res) => {
      utils.listings.list.invalidate();
      toast.success(`Score пересчитан для ${res.total} объявлений (обновлено ${res.updated})`);
    },
    onError: () => toast.error("Ошибка пересчёта score"),
  });

  const updateMutation = trpc.searchConfig.update.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Параметры сохранены — запускаю поиск...");
      setIsScraping(true);
      triggerMutation.mutate();
    },
    onError: (e) => toast.error("Ошибка сохранения: " + e.message),
  });

  // Basic params
  const [minArea, setMinArea] = useState(40);
  const [maxArea, setMaxArea] = useState(70);
  const [minPrice, setMinPrice] = useState(50000);
  const [maxPrice, setMaxPrice] = useState(90000);
  const [footMin, setFootMin] = useState(45);
  const [transportType, setTransportType] = useState<"foot" | "transport">("foot");
  const [officeType, setOfficeType] = useState("office");
  const [maxPages, setMaxPages] = useState(2);

  // Floor filter
  const [minFloor, setMinFloor] = useState<number | null>(null);
  const [maxFloor, setMaxFloor] = useState<number | null>(null);
  const [showFloor, setShowFloor] = useState(false);

  // Metro stations
  const [selectedMetro, setSelectedMetro] = useState<string[]>([]);
  const [showMetroPicker, setShowMetroPicker] = useState(false);
  const [metroSearch, setMetroSearch] = useState("");
  const [expandedLine, setExpandedLine] = useState<string | null>(null);

  // Platform toggles
  const [enableCian, setEnableCian] = useState(true);
  const [enableAvito, setEnableAvito] = useState(true);
  const [enableYandex, setEnableYandex] = useState(true);

  // Districts
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [showDistricts, setShowDistricts] = useState(false);

  // Keywords
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [showKeywords, setShowKeywords] = useState(false);

  useEffect(() => {
    if (config) {
      setMinArea(config.minArea);
      setMaxArea(config.maxArea);
      setMinPrice(Number(config.minPrice));
      setMaxPrice(Number(config.maxPrice));
      setFootMin(config.footMin);
      setTransportType((config.transportType as "foot" | "transport") ?? "foot");
      setOfficeType(config.officeType ?? "office");
      setMaxPages(config.maxPages ?? 2);
      setSelectedMetro((config.metroStations as string[]) ?? []);
      setEnableCian(config.enableCian ?? true);
      setEnableAvito(config.enableAvito ?? true);
      setEnableYandex(config.enableYandex ?? true);
      setMinFloor(config.minFloor ?? null);
      setMaxFloor(config.maxFloor ?? null);
      setKeywords((config.keywords as string[]) ?? []);
      setSelectedDistricts((config.districts as string[]) ?? []);
    }
  }, [config]);

  const toggleMetro = (station: string) => {
    setSelectedMetro((prev) =>
      prev.includes(station) ? prev.filter((s) => s !== station) : [...prev, station]
    );
  };

  const selectAllLine = (stations: string[]) => {
    setSelectedMetro((prev) => {
      const allSelected = stations.every((s) => prev.includes(s));
      if (allSelected) return prev.filter((s) => !stations.includes(s));
      const combined = prev.concat(stations);
      return combined.filter((v, i) => combined.indexOf(v) === i);
    });
  };

  const filteredLines = METRO_LINES.map((line) => ({
    ...line,
    stations: metroSearch
      ? line.stations.filter((s) => s.toLowerCase().includes(metroSearch.toLowerCase()))
      : line.stations,
  })).filter((line) => line.stations.length > 0);

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !keywords.includes(kw)) {
      setKeywords((prev) => [...prev, kw]);
      setKeywordInput("");
    }
  };

  const handleSave = () => {
    updateMutation.mutate({
      minArea,
      maxArea,
      minPrice,
      maxPrice,
      footMin,
      transportType,
      officeType,
      maxPages,
      metroStations: selectedMetro,
      enableCian,
      enableAvito,
      enableYandex,
      minFloor: minFloor,
      maxFloor: maxFloor,
      keywords,
      districts: selectedDistricts,
    });
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div
        className="sticky top-0 z-40 border-b border-border px-4 py-3"
        style={{ background: "oklch(0.16 0.02 250 / 0.95)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <Settings2 size={20} className="text-primary" />
            <span className="font-semibold text-foreground">Параметры поиска</span>
          </div>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || triggerMutation.isPending || isScraping}
            size="sm"
            className="gap-1.5 h-8"
          >
            <Save size={13} className={(triggerMutation.isPending || isScraping) ? "animate-spin" : ""} />
            {updateMutation.isPending ? "Сохранение..." : (triggerMutation.isPending || isScraping) ? "Поиск..." : "Сохранить"}
          </Button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">

        {/* ── Area ── */}
        <RangeInput
          label="Площадь"
          icon={<Maximize2 size={16} className="text-primary" />}
          minVal={minArea}
          maxVal={maxArea}
          onMinChange={setMinArea}
          onMaxChange={setMaxArea}
          min={1}
          max={10000}
          unit="м²"
        />

        {/* ── Price ── */}
        <RangeInput
          label="Цена аренды"
          icon={<DollarSign size={16} className="text-primary" />}
          minVal={minPrice}
          maxVal={maxPrice}
          onMinChange={setMinPrice}
          onMaxChange={setMaxPrice}
          min={0}
          step={1000}
          unit="₽/мес"
        />

        {/* ── Metro distance ── */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Train size={16} className="text-primary" />
            <span className="font-medium text-foreground">Расстояние до метро</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Не более (мин)</Label>
              <Input
                type="number"
                value={footMin}
                onChange={(e) => setFootMin(Number(e.target.value))}
                className="bg-background border-border"
                min={1}
                max={120}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Способ</Label>
              <div className="flex gap-2 mt-1">
                {(["foot", "transport"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTransportType(t)}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                      transportType === t
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {t === "foot" ? "🚶 Пешком" : "🚌 Транспорт"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Office type ── */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-primary" />
            <span className="font-medium text-foreground">Тип помещения</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {OFFICE_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setOfficeType(t.value)}
                className={`text-sm py-2.5 px-3 rounded-xl border transition-colors text-left ${
                  officeType === t.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Metro stations ── */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-primary" />
              <span className="font-medium text-foreground">Станции метро</span>
              {selectedMetro.length > 0 && (
                <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                  {selectedMetro.length}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowMetroPicker(!showMetroPicker)}
              className="flex items-center gap-1 text-xs text-primary"
            >
              <Plus size={12} />
              {showMetroPicker ? "Скрыть" : "Изменить"}
            </button>
          </div>

          {/* Selected badges */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selectedMetro.length === 0 ? (
              <span className="text-sm text-muted-foreground">Все станции</span>
            ) : (
              <>
                {selectedMetro.slice(0, 8).map((s) => (
                  <span
                    key={s}
                    className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full border border-primary/20"
                  >
                    {s}
                    <button onClick={() => toggleMetro(s)} className="hover:text-destructive">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {selectedMetro.length > 8 && (
                  <span className="text-xs text-muted-foreground self-center">
                    +{selectedMetro.length - 8} ещё
                  </span>
                )}
                <button
                  onClick={() => setSelectedMetro([])}
                  className="text-xs text-muted-foreground hover:text-destructive ml-1"
                >
                  Очистить все
                </button>
              </>
            )}
          </div>

          {/* Metro picker */}
          {showMetroPicker && (
            <div className="border-t border-border pt-3 space-y-2">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск станции..."
                  value={metroSearch}
                  onChange={(e) => setMetroSearch(e.target.value)}
                  className="pl-8 h-8 text-sm bg-background border-border"
                />
              </div>

              {/* Quick actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedMetro(ALL_STATIONS)}
                  className="text-xs text-primary hover:underline"
                >
                  Выбрать все
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={() => setSelectedMetro([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Сбросить
                </button>
              </div>

              {/* Lines */}
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {filteredLines.map((line) => {
                  const allSelected = line.stations.every((s) => selectedMetro.includes(s));
                  const someSelected = line.stations.some((s) => selectedMetro.includes(s));
                  const isExpanded = expandedLine === line.line || !!metroSearch;

                  return (
                    <div key={line.line} className="rounded-xl border border-border overflow-hidden">
                      {/* Line header */}
                      <button
                        onClick={() => setExpandedLine(isExpanded && !metroSearch ? null : line.line)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: line.color }}
                        />
                        <span className="text-xs font-medium text-foreground flex-1 text-left">
                          {line.line}
                        </span>
                        {someSelected && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: line.color + "30", color: line.color }}
                          >
                            {line.stations.filter((s) => selectedMetro.includes(s)).length}
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); selectAllLine(line.stations); }}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                            allSelected
                              ? "border-primary/50 text-primary bg-primary/10"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {allSelected ? "Снять" : "Все"}
                        </button>
                        {!metroSearch && (
                          isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />
                        )}
                      </button>

                      {/* Stations */}
                      {isExpanded && (
                        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                          {line.stations.map((station) => (
                            <button
                              key={station}
                              onClick={() => toggleMetro(station)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                selectedMetro.includes(station)
                                  ? "text-white border-transparent"
                                  : "bg-background text-muted-foreground border-border hover:text-foreground"
                              }`}
                              style={
                                selectedMetro.includes(station)
                                  ? { background: line.color, borderColor: line.color }
                                  : {}
                              }
                            >
                              {station}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Floor filter (collapsible) ── */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setShowFloor(!showFloor)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-primary" />
              <span className="font-medium text-foreground">Этаж</span>
              {(minFloor || maxFloor) && (
                <span className="text-xs text-muted-foreground">
                  {minFloor ? `от ${minFloor}` : ""}{minFloor && maxFloor ? " — " : ""}{maxFloor ? `до ${maxFloor}` : ""}
                </span>
              )}
            </div>
            {showFloor ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
          </button>
          {showFloor && (
            <div className="px-4 pb-4 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">От этажа</Label>
                  <Input
                    type="number"
                    value={minFloor ?? ""}
                    onChange={(e) => setMinFloor(e.target.value ? Number(e.target.value) : null)}
                    placeholder="Любой"
                    className="bg-background border-border"
                    min={1}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">До этажа</Label>
                  <Input
                    type="number"
                    value={maxFloor ?? ""}
                    onChange={(e) => setMaxFloor(e.target.value ? Number(e.target.value) : null)}
                    placeholder="Любой"
                    className="bg-background border-border"
                    min={1}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Оставьте пустым для поиска на всех этажах
              </p>
            </div>
          )}
        </div>

        {/* ── Districts (collapsible) ── */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setShowDistricts(!showDistricts)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Map size={16} className="text-primary" />
              <span className="font-medium text-foreground">Районы СПб</span>
              {selectedDistricts.length > 0 ? (
                <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                  {selectedDistricts.length} выбрано
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">все районы</span>
              )}
            </div>
            {showDistricts ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
          </button>
          {showDistricts && (
            <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Оставьте пустым для поиска по всем районам. Фильтрация применяется к адресу объявления.
              </p>
              <div className="flex gap-2 mb-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => setSelectedDistricts([...SPB_DISTRICTS])}
                >
                  Все
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => setSelectedDistricts([])}
                >
                  Сбросить
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SPB_DISTRICTS.map((district) => {
                  const selected = selectedDistricts.includes(district);
                  return (
                    <button
                      key={district}
                      onClick={() =>
                        setSelectedDistricts((prev) =>
                          selected ? prev.filter((d) => d !== district) : [...prev, district]
                        )
                      }
                      className={`text-left text-xs px-3 py-2 rounded-xl border transition-colors ${
                        selected
                          ? "bg-primary/15 border-primary/40 text-primary font-medium"
                          : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                      }`}
                    >
                      {district}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Keywords (collapsible) ── */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setShowKeywords(!showKeywords)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Tag size={16} className="text-primary" />
              <span className="font-medium text-foreground">Ключевые слова</span>
              {keywords.length > 0 && (
                <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                  {keywords.length}
                </span>
              )}
            </div>
            {showKeywords ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
          </button>
          {showKeywords && (
            <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Фильтрация объявлений по словам в названии или описании
              </p>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                  placeholder="Например: ремонт, парковка..."
                  className="bg-background border-border text-sm"
                />
                <Button onClick={addKeyword} size="sm" variant="outline" className="shrink-0">
                  <Plus size={14} />
                </Button>
              </div>
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="flex items-center gap-1 bg-muted text-foreground text-xs px-2.5 py-1 rounded-full border border-border"
                    >
                      {kw}
                      <button
                        onClick={() => setKeywords((prev) => prev.filter((k) => k !== kw))}
                        className="hover:text-destructive"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Platforms ── */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Search size={16} className="text-primary" />
            <span className="font-medium text-foreground">Площадки для поиска</span>
          </div>
          <div className="space-y-3">
            {[
              { key: "cian", label: "ЦИАН", desc: "Работает (Playwright)", val: enableCian, set: setEnableCian },
              { key: "avito", label: "Авито", desc: "Блокирует по IP", val: enableAvito, set: setEnableAvito },
              { key: "yandex", label: "Яндекс Недвижимость", desc: "Работает (Playwright)", val: enableYandex, set: setEnableYandex },
            ].map((p) => (
              <div key={p.key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.desc}</div>
                </div>
                <Switch
                  checked={p.val}
                  onCheckedChange={p.set}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Scrape depth ── */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={16} className="text-primary" />
            <span className="font-medium text-foreground">Глубина поиска</span>
          </div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Страниц на площадку (1 стр ≈ 25 объявлений)
          </Label>
          <div className="flex gap-2">
            {[1, 2, 3, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => setMaxPages(n)}
                className={`flex-1 text-sm py-2 rounded-xl border transition-colors ${
                  maxPages === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Больше страниц = больше объявлений, но дольше цикл мониторинга
          </p>
        </div>

        {/* Save button */}
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || triggerMutation.isPending || isScraping}
          className="w-full h-12 text-base font-medium gap-2"
        >
          <Save size={16} className={(triggerMutation.isPending || isScraping) ? "animate-spin" : ""} />
          {updateMutation.isPending
            ? "Сохранение..."
            : (triggerMutation.isPending || isScraping)
            ? "Запускаю поиск..."
            : "Сохранить и обновить выдачу"}
        </Button>

        {/* Rescore button */}
        <Button
          onClick={() => rescoreMutation.mutate()}
          disabled={rescoreMutation.isPending}
          variant="outline"
          className="w-full h-10 gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {rescoreMutation.isPending ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {rescoreMutation.isPending ? "Пересчёт..." : "Пересчитать score по текущим данным"}
        </Button>

        {(triggerMutation.isPending || isScraping) && progress && (
          <div className="flex items-center justify-center gap-2 pb-2">
            {(["cian", "yandex", "avito"] as const).map((p) => {
              const ps = progress.platforms[p];
              if (ps.status === "skipped") return null;
              const label = p === "cian" ? "ЦИАН" : p === "yandex" ? "Яндекс" : "Авито";
              return (
                <span
                  key={p}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded flex items-center gap-1 ${
                    ps.status === "running"
                      ? "bg-primary/20 text-primary animate-pulse"
                      : ps.status === "done"
                      ? "bg-green-500/20 text-green-400"
                      : ps.status === "error"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ps.status === "running" && <RefreshCw size={9} className="animate-spin" />}
                  {ps.status === "done" && <span>✓</span>}
                  {ps.status === "error" && <span>✗</span>}
                  {label}
                  {ps.status === "done" && ps.found > 0 && <span className="opacity-70"> {ps.found}</span>}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
