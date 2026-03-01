import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings2, MapPin, DollarSign, Maximize2, Train, Save, X, Plus } from "lucide-react";
import { toast } from "sonner";

const SPB_METRO_STATIONS = [
  "Приморская", "Василеостровская", "Гостиный двор", "Невский проспект",
  "Площадь Восстания", "Чернышевская", "Площадь Ленина", "Выборгская",
  "Лесная", "Площадь Мужества", "Политехническая", "Академическая",
  "Гражданский проспект", "Девяткино", "Проспект Просвещения",
  "Озерки", "Удельная", "Пионерская", "Чёрная речка",
  "Петроградская", "Горьковская", "Спортивная", "Адмиралтейская",
  "Садовая", "Сенная площадь", "Технологический институт",
  "Фрунзенская", "Московские ворота", "Электросила", "Парк Победы",
  "Московская", "Звёздная", "Купчино",
];

export default function Settings() {
  const { data: config, refetch } = trpc.searchConfig.get.useQuery();
  const updateMutation = trpc.searchConfig.update.useMutation({
    onSuccess: () => { toast.success("Параметры сохранены"); refetch(); },
    onError: () => toast.error("Ошибка сохранения"),
  });

  const [minArea, setMinArea] = useState(40);
  const [maxArea, setMaxArea] = useState(70);
  const [minPrice, setMinPrice] = useState(50000);
  const [maxPrice, setMaxPrice] = useState(90000);
  const [footMin, setFootMin] = useState(45);
  const [selectedMetro, setSelectedMetro] = useState<string[]>([]);
  const [showMetroPicker, setShowMetroPicker] = useState(false);

  useEffect(() => {
    if (config) {
      setMinArea(config.minArea);
      setMaxArea(config.maxArea);
      setMinPrice(Number(config.minPrice));
      setMaxPrice(Number(config.maxPrice));
      setFootMin(config.footMin);
      setSelectedMetro((config.metroStations as string[]) ?? []);
    }
  }, [config]);

  const toggleMetro = (station: string) => {
    setSelectedMetro((prev) =>
      prev.includes(station) ? prev.filter((s) => s !== station) : [...prev, station]
    );
  };

  const handleSave = () => {
    updateMutation.mutate({
      minArea,
      maxArea,
      minPrice,
      maxPrice,
      footMin,
      metroStations: selectedMetro,
    });
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div
        className="sticky top-0 z-40 border-b border-border px-4 py-3"
        style={{ background: "oklch(0.16 0.02 250 / 0.95)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-2 max-w-lg mx-auto">
          <Settings2 size={20} className="text-primary" />
          <span className="font-semibold text-foreground">Параметры поиска</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-5 space-y-5">
        {/* Area */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Maximize2 size={16} className="text-primary" />
            <span className="font-medium text-foreground">Площадь (м²)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">От</Label>
              <Input
                type="number"
                value={minArea}
                onChange={(e) => setMinArea(Number(e.target.value))}
                className="bg-background border-border"
                min={1}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">До</Label>
              <Input
                type="number"
                value={maxArea}
                onChange={(e) => setMaxArea(Number(e.target.value))}
                className="bg-background border-border"
                min={1}
              />
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={16} className="text-primary" />
            <span className="font-medium text-foreground">Цена аренды (₽/мес)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">От</Label>
              <Input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(Number(e.target.value))}
                className="bg-background border-border"
                min={0}
                step={1000}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">До</Label>
              <Input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="bg-background border-border"
                min={0}
                step={1000}
              />
            </div>
          </div>
        </div>

        {/* Metro distance */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Train size={16} className="text-primary" />
            <span className="font-medium text-foreground">Пешком до метро (мин)</span>
          </div>
          <Input
            type="number"
            value={footMin}
            onChange={(e) => setFootMin(Number(e.target.value))}
            className="bg-background border-border"
            min={1}
            max={120}
          />
          <p className="text-xs text-muted-foreground mt-2">
            Максимальное время пешком до ближайшей станции метро
          </p>
        </div>

        {/* Metro stations */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-primary" />
              <span className="font-medium text-foreground">Станции метро</span>
            </div>
            <button
              onClick={() => setShowMetroPicker(!showMetroPicker)}
              className="flex items-center gap-1 text-xs text-primary"
            >
              <Plus size={12} />
              {showMetroPicker ? "Скрыть" : "Изменить"}
            </button>
          </div>

          {/* Selected stations */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {selectedMetro.length === 0 ? (
              <span className="text-sm text-muted-foreground">Все станции</span>
            ) : (
              selectedMetro.map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full border border-primary/20"
                >
                  {s}
                  <button onClick={() => toggleMetro(s)} className="hover:text-destructive">
                    <X size={10} />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Metro picker */}
          {showMetroPicker && (
            <div className="border-t border-border pt-3">
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {SPB_METRO_STATIONS.map((station) => (
                  <button
                    key={station}
                    onClick={() => toggleMetro(station)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      selectedMetro.includes(station)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {station}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Save button */}
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="w-full h-12 text-base font-medium gap-2"
        >
          <Save size={16} />
          {updateMutation.isPending ? "Сохранение..." : "Сохранить параметры"}
        </Button>

        <p className="text-xs text-muted-foreground text-center pb-4">
          Изменения вступят в силу при следующем запуске мониторинга
        </p>
      </div>
    </div>
  );
}
