import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusCircle,
  Link,
  MapPin,
  Train,
  DollarSign,
  Maximize2,
  Building2,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function AddListingPage() {
  const [, navigate] = useLocation();
  const [platform, setPlatform] = useState<"cian" | "avito" | "yandex">("cian");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [metroStation, setMetroStation] = useState("");
  const [metroDistanceMin, setMetroDistanceMin] = useState("");
  const [price, setPrice] = useState("");
  const [area, setArea] = useState("");
  const [floor, setFloor] = useState("");
  const [totalFloors, setTotalFloors] = useState("");
  const [description, setDescription] = useState("");
  const [added, setAdded] = useState(false);

  const utils = trpc.useUtils();
  const addMutation = trpc.listings_manage.add.useMutation({
    onSuccess: () => {
      toast.success("Объявление добавлено!");
      utils.listings.list.invalidate();
      utils.listings.stats.invalidate();
      setAdded(true);
      setTimeout(() => navigate("/"), 1500);
    },
    onError: (err) => toast.error(`Ошибка: ${err.message}`),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      toast.error("Введите ссылку на объявление");
      return;
    }

    addMutation.mutate({
      platform,
      url,
      title: title || undefined,
      address: address || undefined,
      metroStation: metroStation || undefined,
      metroDistanceMin: metroDistanceMin ? parseInt(metroDistanceMin) : undefined,
      price: price ? parseInt(price) : undefined,
      area: area ? parseInt(area) : undefined,
      floor: floor ? parseInt(floor) : undefined,
      totalFloors: totalFloors ? parseInt(totalFloors) : undefined,
      description: description || undefined,
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
          <PlusCircle size={20} className="text-primary" />
          <span className="font-semibold text-foreground">Добавить объявление</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-5">
        {added ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <CheckCircle2 size={48} className="text-green-400" />
            <p className="text-foreground font-medium">Объявление добавлено!</p>
            <p className="text-sm text-muted-foreground">Возвращаемся к ленте...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Platform */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <Label className="text-xs text-muted-foreground mb-2 block">Площадка</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cian">ЦИАН</SelectItem>
                  <SelectItem value="avito">Авито</SelectItem>
                  <SelectItem value="yandex">Яндекс Недвижимость</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* URL */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Link size={14} className="text-primary" />
                <Label className="text-sm font-medium text-foreground">Ссылка на объявление *</Label>
              </div>
              <Input
                type="url"
                placeholder="https://spb.cian.ru/rent/commercial/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-background border-border"
                required
              />
            </div>

            {/* Price & Area */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign size={13} className="text-primary" />
                    <Label className="text-xs text-muted-foreground">Цена (₽/мес)</Label>
                  </div>
                  <Input
                    type="number"
                    placeholder="75000"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="bg-background border-border"
                    min={0}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Maximize2 size={13} className="text-primary" />
                    <Label className="text-xs text-muted-foreground">Площадь (м²)</Label>
                  </div>
                  <Input
                    type="number"
                    placeholder="55"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className="bg-background border-border"
                    min={1}
                  />
                </div>
              </div>
            </div>

            {/* Address */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={14} className="text-primary" />
                <Label className="text-sm font-medium text-foreground">Адрес</Label>
              </div>
              <Input
                placeholder="ул. Невский проспект, 1"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="bg-background border-border"
              />
            </div>

            {/* Metro */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Train size={14} className="text-primary" />
                <Label className="text-sm font-medium text-foreground">Метро</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Станция</Label>
                  <Input
                    placeholder="Невский проспект"
                    value={metroStation}
                    onChange={(e) => setMetroStation(e.target.value)}
                    className="bg-background border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Мин пешком</Label>
                  <Input
                    type="number"
                    placeholder="10"
                    value={metroDistanceMin}
                    onChange={(e) => setMetroDistanceMin(e.target.value)}
                    className="bg-background border-border"
                    min={1}
                    max={120}
                  />
                </div>
              </div>
            </div>

            {/* Floor */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={14} className="text-primary" />
                <Label className="text-sm font-medium text-foreground">Этаж</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Этаж</Label>
                  <Input
                    type="number"
                    placeholder="3"
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    className="bg-background border-border"
                    min={1}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Всего этажей</Label>
                  <Input
                    type="number"
                    placeholder="9"
                    value={totalFloors}
                    onChange={(e) => setTotalFloors(e.target.value)}
                    className="bg-background border-border"
                    min={1}
                  />
                </div>
              </div>
            </div>

            {/* Title & Description */}
            <div className="bg-card rounded-2xl p-4 border border-border space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Название (необязательно)</Label>
                <Input
                  placeholder="Офис в бизнес-центре"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-background border-border"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Описание (необязательно)</Label>
                <Textarea
                  placeholder="Краткое описание объявления..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-background border-border resize-none"
                  rows={3}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={addMutation.isPending || !url}
              className="w-full h-12 text-base font-medium gap-2"
            >
              {addMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <PlusCircle size={16} />
              )}
              {addMutation.isPending ? "Добавление..." : "Добавить объявление"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
