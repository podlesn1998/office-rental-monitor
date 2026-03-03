import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Send,
  Bot,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";
import { toast } from "sonner";

export default function TelegramPage() {
  const { data: config, refetch } = trpc.telegram.get.useQuery();

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [active, setActive] = useState(false);
  const [threadNew, setThreadNew] = useState("");
  const [threadInteresting, setThreadInteresting] = useState("");
  const [threadNotInteresting, setThreadNotInteresting] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [silentSave, setSilentSave] = useState(false);

  useEffect(() => {
    if (config) {
      setChatId(config.chatId ?? "");
      setActive(config.active);
      setThreadNew(config.threadNew != null ? String(config.threadNew) : "");
      setThreadInteresting(config.threadInteresting != null ? String(config.threadInteresting) : "");
      setThreadNotInteresting(config.threadNotInteresting != null ? String(config.threadNotInteresting) : "");
    }
  }, [config]);

  const updateMutation = trpc.telegram.update.useMutation({
    onSuccess: () => {
      if (!silentSave) toast.success("Настройки Telegram сохранены");
      setSilentSave(false);
      refetch();
    },
    onError: () => toast.error("Ошибка сохранения"),
  });

  const testMutation = trpc.telegram.test.useMutation({
    onSuccess: (res) => {
      setTestResult({
        success: res.success,
        message: res.success
          ? `Подключено! Бот: ${res.botName}`
          : res.error ?? "Ошибка подключения",
      });
      if (res.success) {
        // Auto-enable notifications and auto-save on successful test
        setActive(true);
        setSilentSave(true); // suppress duplicate toast
        const saveData: Record<string, unknown> = { active: true };
        if (botToken) saveData.botToken = botToken;
        if (chatId) saveData.chatId = chatId;
        updateMutation.mutate(saveData as Parameters<typeof updateMutation.mutate>[0]);
        toast.success(`Подключено! Бот: ${res.botName}. Настройки сохранены автоматически.`);
      } else {
        toast.error(res.error ?? "Ошибка подключения");
      }
    },
    onError: () => {
      setTestResult({ success: false, message: "Ошибка при тестировании" });
    },
  });

  const sendPendingMutation = trpc.telegram.sendPending.useMutation({
    onSuccess: (res) => toast.success(`Отправлено ${res.sent} объявлений`),
    onError: () => toast.error("Ошибка отправки"),
  });

  const registerWebhookMutation = trpc.telegram.registerWebhook.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`Webhook зарегистрирован: ${res.webhookUrl}`);
      } else {
        toast.error("Ошибка регистрации webhook");
      }
    },
    onError: () => toast.error("Ошибка регистрации webhook"),
  });

  const handleSave = () => {
    const data: Record<string, unknown> = { active };
    if (botToken) data.botToken = botToken;
    if (chatId) data.chatId = chatId;
    data.threadNew = threadNew ? parseInt(threadNew, 10) : null;
    data.threadInteresting = threadInteresting ? parseInt(threadInteresting, 10) : null;
    data.threadNotInteresting = threadNotInteresting ? parseInt(threadNotInteresting, 10) : null;
    updateMutation.mutate(data as Parameters<typeof updateMutation.mutate>[0]);
  };

  const handleTest = () => {
    const token = botToken || "";
    if (!token || !chatId) {
      toast.error("Введите токен бота и Chat ID");
      return;
    }
    setTestResult(null);
    testMutation.mutate({ botToken: token, chatId });
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div
        className="sticky top-0 z-40 border-b border-border px-4 py-3"
        style={{ background: "oklch(0.16 0.02 250 / 0.95)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-2 max-w-lg mx-auto">
          <Send size={20} className="text-primary" />
          <span className="font-semibold text-foreground">Telegram-бот</span>
          {config?.active && (
            <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
              <CheckCircle2 size={12} />
              Активен
            </span>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">
        {/* Instructions */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <Info size={16} className="text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-foreground/80 space-y-1.5">
              <p className="font-medium text-foreground">Как настроить бота:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Откройте <strong className="text-foreground">@BotFather</strong> в Telegram</li>
                <li>Отправьте <code className="bg-background px-1 rounded">/newbot</code> и следуйте инструкциям</li>
                <li>Скопируйте полученный токен и вставьте ниже</li>
                <li>Узнайте ваш Chat ID через <strong className="text-foreground">@userinfobot</strong></li>
                <li>Нажмите «Тест» для проверки подключения</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Bot token */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Bot size={16} className="text-primary" />
            <span className="font-medium text-foreground">Токен бота</span>
          </div>
          <Input
            type="password"
            placeholder={config?.hasToken ? "Токен уже сохранён (введите новый для замены)" : "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className="bg-background border-border font-mono text-sm"
          />
          {config?.hasToken && !botToken && (
            <p className="text-xs text-green-400 mt-1.5 flex items-center gap-1">
              <CheckCircle2 size={11} />
              Токен сохранён
            </p>
          )}
        </div>

        {/* Chat ID */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare size={16} className="text-primary" />
            <span className="font-medium text-foreground">Chat ID</span>
          </div>
          <Input
            placeholder="Например: 123456789 или -1001234567890"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="bg-background border-border"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Узнайте ваш ID через @userinfobot или @getidsbot в Telegram
          </p>
        </div>

        {/* Topics (Forum threads) */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={16} className="text-primary" />
            <span className="font-medium text-foreground">Telegram Topics (топики)</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Если бот добавлен в группу с включёнными темами, укажите Thread ID каждого топика.
            Напишите <code className="bg-background px-1 rounded">/getids</code> внутри нужного топика, чтобы узнать его ID.
          </p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">🆕 Топик «Новые объявления» (Thread ID)</Label>
              <Input
                placeholder="Например: 2"
                value={threadNew}
                onChange={(e) => setThreadNew(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">⭐ Топик «Интересные» (Thread ID)</Label>
              <Input
                placeholder="Например: 4"
                value={threadInteresting}
                onChange={(e) => setThreadInteresting(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">👎 Топик «Неинтересные» (Thread ID)</Label>
              <Input
                placeholder="Например: 6"
                value={threadNotInteresting}
                onChange={(e) => setThreadNotInteresting(e.target.value)}
                className="bg-background border-border"
              />
            </div>
          </div>
        </div>

        {/* Active toggle */}
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Уведомления активны</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Бот будет присылать новые объявления
              </p>
            </div>
            <Switch
              checked={active}
              onCheckedChange={setActive}
            />
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`rounded-2xl p-4 border flex items-start gap-3 ${
              testResult.success
                ? "bg-green-500/10 border-green-500/30"
                : "bg-destructive/10 border-destructive/30"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 size={16} className="text-green-400 mt-0.5 shrink-0" />
            ) : (
              <XCircle size={16} className="text-destructive mt-0.5 shrink-0" />
            )}
            <span className={`text-sm ${testResult.success ? "text-green-400" : "text-destructive"}`}>
              {testResult.message}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3">
          <Button
            onClick={handleTest}
            variant="outline"
            disabled={testMutation.isPending || (!botToken && !config?.hasToken)}
            className="w-full h-11 gap-2"
          >
            {testMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            {testMutation.isPending ? "Тестирование..." : "Тест подключения"}
          </Button>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full h-12 text-base font-medium gap-2"
          >
            {updateMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            {updateMutation.isPending ? "Сохранение..." : "Сохранить настройки"}
          </Button>

          {(config?.hasToken || botToken) && chatId && (
            <Button
              onClick={() => sendPendingMutation.mutate()}
              disabled={sendPendingMutation.isPending}
              variant="outline"
              className="w-full h-11 gap-2 border-primary/40 text-primary hover:bg-primary/10"
            >
              {sendPendingMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
              {sendPendingMutation.isPending ? "Отправка..." : "📨 Отправить все объявления в Telegram"}
            </Button>
          )}

          {config?.hasToken && (
            <Button
              onClick={() => registerWebhookMutation.mutate()}
              disabled={registerWebhookMutation.isPending}
              variant="outline"
              className="w-full h-11 gap-2 text-muted-foreground hover:text-foreground"
            >
              {registerWebhookMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Bot size={15} />
              )}
              {registerWebhookMutation.isPending ? "Регистрация..." : "🔗 Зарегистрировать Webhook (кнопки в боте)"}
            </Button>
          )}
        </div>

        {/* Status info */}
        {config && (
          <div className="bg-card rounded-2xl p-4 border border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">Статус</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Бот настроен</span>
                <span className={config.hasToken ? "text-green-400" : "text-muted-foreground"}>
                  {config.hasToken ? "Да" : "Нет"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chat ID</span>
                <span className="text-foreground">{config.chatId ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Уведомления</span>
                <span className={config.active ? "text-green-400" : "text-muted-foreground"}>
                  {config.active ? "Включены" : "Выключены"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
