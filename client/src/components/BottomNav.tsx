import { Link, useLocation } from "wouter";
import { Building2, Settings, Send, Activity, PlusCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

const navItems = [
  { path: "/", icon: Building2, label: "Объявления" },
  { path: "/add", icon: PlusCircle, label: "Добавить" },
  { path: "/telegram", icon: Send, label: "Telegram" },
  { path: "/settings", icon: Settings, label: "Настройки" },
  { path: "/logs", icon: Activity, label: "Логи" },
];

export default function BottomNav() {
  const [location] = useLocation();
  const { data: stats } = trpc.listings.stats.useQuery(undefined, {
    refetchInterval: 60000,
  });

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border"
      style={{
        background: "oklch(0.16 0.02 250 / 0.95)",
        backdropFilter: "blur(12px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location === path;
          const showBadge = path === "/" && stats && stats.newCount > 0;

          return (
            <Link key={path} href={path}>
              <button
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all relative ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="relative">
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={isActive ? "text-primary" : ""}
                  />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full text-[9px] font-bold text-primary-foreground flex items-center justify-center new-badge">
                      {stats.newCount > 9 ? "9+" : stats.newCount}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-medium ${isActive ? "text-primary" : ""}`}>
                  {label}
                </span>
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                )}
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
