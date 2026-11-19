interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; username?: string; first_name?: string } };
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export const tg = window.Telegram?.WebApp;

const DEBUG_ID = Number(import.meta.env.VITE_DEBUG_TELEGRAM_ID ?? 123456789);

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0b0d1f");
  tg.setBackgroundColor?.("#0b0d1f");
}

/** В Telegram берём реальный id, в обычном браузере — тестовый. */
export function getTelegramId(): number {
  return tg?.initDataUnsafe?.user?.id ?? DEBUG_ID;
}
