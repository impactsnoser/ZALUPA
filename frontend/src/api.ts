/**
 * Адрес API.
 *
 * Vite подставляет import.meta.env.VITE_API_URL ВО ВРЕМЯ СБОРКИ, а не в рантайме.
 * Значит переменную нужно задать в настройках фронтенд-сервиса Railway и пересобрать.
 *
 * Порядок поиска:
 *   1. window.__NEXORA_API_URL__ — рантайм-переопределение (если понадобится);
 *   2. VITE_API_URL из окружения сборки;
 *   3. localhost — только для локальной разработки.
 */
import type { Prize } from "./data/cases";
import { tg } from "./telegram";

const DEFAULT_API_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 2_000;

declare global {
  interface Window {
    /** Позволяет задать адрес API без пересборки бандла. */
    __NEXORA_API_URL__?: string;
  }
}

function resolveApiUrl(): string {
  const fromWindow = typeof window !== "undefined" ? window.__NEXORA_API_URL__ : undefined;
  const raw = (fromWindow || import.meta.env.VITE_API_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  return DEFAULT_API_URL;
}

export const API_URL = resolveApiUrl();

/** true, если адрес взят по умолчанию (на Railway это почти всегда ошибка конфигурации). */
export const IS_FALLBACK_API_URL = API_URL === DEFAULT_API_URL;

/** Должен совпадать с MARGIN_COEF на бэкенде (только для предпросмотра шанса). */
export const MARGIN = 0.92;

export interface Gift {
  id: number;
  name: string;
  price_stars: number;
  image_url: string | null;
  is_nft: boolean;
}

export interface InventoryItem {
  inventory_id: number;
  gift_id: number | null;
  name: string;
  price_stars: number;
  image_url: string | null;
  is_nft: boolean;
  kind: "gift" | "prize";
  emoji: string | null;
}

export interface UserProfile {
  id: number;
  telegram_id: number;
  username: string | null;
  balance_stars: number;
  balance_ton?: number;
  stars_per_ton?: number;
  inventory: InventoryItem[];
}

export interface WalletTransaction {
  id: number;
  amount_stars: number;
  amount_ton: number;
  kind: string;
  label: string | null;
  balance_after: number;
  created_at: string;
}

export interface Wallet {
  telegram_id: number;
  balance_stars: number;
  balance_ton: number;
  stars_per_ton: number;
  ton_deposit_enabled: boolean;
  ton_address: string | null;
  is_admin?: boolean;
  activity_count: number;
  transactions: WalletTransaction[];
}

export interface StarsInvoice {
  payment_id: number;
  invoice_link: string;
  stars: number;
  amount_ton: number;
}

export interface TonInvoice {
  payment_id: number;
  address: string;
  comment: string;
  amount_ton: number;
  amount_nano: number;
  amount_stars: number;
  expires_at: string | null;
}

export interface TonCheckResult {
  status: "pending" | "paid" | "expired";
  balance_stars: number;
  balance_ton?: number;
  amount_ton?: number | null;
  amount_stars?: number | null;
}

export interface SnowfallGame {
  session_id: number;
  status: "active" | "chest" | "opened";
  bet_stars: number;
  bet_ton: number;
  tool: { name: string; emoji: string; rarity: string; durability: number; max_durability: number };
  progress: number;
  target: number;
  blocks: { name: string; emoji: string; hp: number; max_hp: number; destroyed: boolean; kind: string }[];
  reward: { kind: "stars" | "gift" | "nft"; name: string; emoji: string; stars: number; inventory_id: number | null } | null;
  balance_stars: number;
  balance_ton: number;
}

export interface TonConnectDeposit {
  depositId: string;
  transaction: { network: string; validUntil: number; messages: { address: string; amount: string; payload: string }[] };
  amountStars: number;
}

export interface InventoryList {
  items: InventoryItem[];
}

export interface SellResult {
  sold_stars: number;
  sold_ton: number;
  balance_stars: number;
  balance_ton: number;
}

export interface SellAllResult extends SellResult {
  sold_count: number;
}

export interface WithdrawResult {
  withdrawn: {
    inventory_id: number;
    name: string;
    image_url: string | null;
    is_nft: boolean;
  };
  message: string;
}

export interface AdminUser {
  telegram_id: number;
  username: string | null;
  balance_stars: number;
  is_admin: boolean;
  is_root: boolean;
  luck_multiplier: number;
}

export interface AdminCaseSetting {
  id: string;
  title: string;
  price: number;
  luck_multiplier: number;
}

export interface AdminSettings {
  cases: AdminCaseSetting[];
  max_luck: number;
}

export interface UpgradeResult {
  win: boolean;
  roll: number; // 0..1, победа если roll < chance
  chance: number; // 0..1
  new_inventory_id: number | null;
}

export interface RegisterResult {
  telegram_id: number;
  created: boolean;
}

export interface StarterResult {
  inventory_id: number;
  gift_id: number;
  name: string;
  price_stars: number;
  image_url: string | null;
  is_nft: boolean;
}

export interface BattleCase { id: string; title: string; price: number }
export interface BattleRoom {
  battle_id: string;
  status: "waiting" | "completed" | "expired" | "cancelled";
  case: BattleCase;
  bet_stars: number;
  bet_ton: number;
  creator_username: string;
  opponent_username: string | null;
  expires_at: number;
  result: {
    you: { name: string; value_stars: number; image_url: string | null } | null;
    opponent: { name: string; value_stars: number; image_url: string | null } | null;
    won: boolean;
    draw: boolean;
    winner_username: string | null;
    you_receive_both: boolean;
  } | null;
  balance_stars: number;
  balance_ton: number;
}

async function requestOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        // Content-Type нужен только для запросов с телом, иначе GET уходит в preflight
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        // Подпись Telegram: бэкенд проверяет её и не доверяет telegram_id из тела
        ...(tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {}),
        "ngrok-skip-browser-warning": "1",
        ...(init?.headers as Record<string, string> | undefined),
      },
      signal: init?.signal ?? controller.signal,
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "AbortError";
    const reason = timedOut
      ? `сервер не ответил за ${REQUEST_TIMEOUT_MS / 1000} c (возможно, просыпается после простоя)`
      : "запрос заблокирован или сервер недоступен";
    console.error(`[api] ${url} — ${reason}`, err);
    const error = new Error(
      `Нет связи с API: ${API_URL} (${reason}). ` +
        "Проверьте, что бэкенд запущен и доступен по HTTPS.",
    );
    error.name = "NetworkError";
    throw error;
  } finally {
    window.clearTimeout(timer);
  }

  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("json") || /^\s*[\[{]/.test(raw);

  if (!res.ok) {
    let detail = `Ошибка ${res.status}`;
    try {
      const body = JSON.parse(raw);
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* не JSON */
    }
    console.error(`[api] ${url} — ${res.status} ${detail}`);
    throw new Error(detail);
  }

  if (!isJson) {
    const preview = raw.replace(/\s+/g, " ").slice(0, 120);
    console.error(`[api] ${url} — ожидался JSON, пришёл ${contentType || "текст"}`, preview);
    throw new Error(
      `Адрес API (${API_URL}) вернул HTML/текст вместо JSON. ` +
        "Похоже, VITE_API_URL указывает на фронтенд или заглушку, а не на FastAPI. " +
        `Начало ответа: ${preview}`,
    );
  }

  return JSON.parse(raw) as T;
}

/**
 * GET-запросы повторяем один раз: бэкенд на Railway может «просыпаться»
 * и на первый запрос отдать таймаут или HTML-страницу шлюза.
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestOnce<T>(path, init);
    } catch (err) {
      const retryable = err instanceof Error && err.name === "NetworkError";
      if (!retryable || attempt >= attempts) throw err;
      console.warn(`[api] повтор ${path} (попытка ${attempt + 1}/${attempts})`);
      await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

export const api = {
  getUser: (telegramId: number) => request<UserProfile>(`/api/user/${telegramId}`),
  getBattleCases: () => request<BattleCase[]>("/api/battles/cases"),
  getBattleLobby: (telegramId: number) => request<{ rooms: { battle_id: string; username: string; case: BattleCase; bet_stars: number; bet_ton: number; expires_at: number }[] }>(`/api/battles/lobby?telegram_id=${telegramId}`),
  getMyBattle: (telegramId: number) => request<{ battle: BattleRoom | null }>(`/api/battles/mine?telegram_id=${telegramId}`),
  getBattle: (battleId: string, telegramId: number) => request<BattleRoom>(`/api/battles/${encodeURIComponent(battleId)}?telegram_id=${telegramId}`),
  createBattle: (telegramId: number, caseId: string) => request<BattleRoom>("/api/battles", { method: "POST", body: JSON.stringify({ telegram_id: telegramId, case_id: caseId }) }),
  joinBattle: (telegramId: number, battleId: string) => request<BattleRoom>(`/api/battles/${encodeURIComponent(battleId)}/join`, { method: "POST", body: JSON.stringify({ telegram_id: telegramId }) }),
  cancelBattle: (telegramId: number, battleId: string) => request<BattleRoom>(`/api/battles/${encodeURIComponent(battleId)}/cancel`, { method: "POST", body: JSON.stringify({ telegram_id: telegramId }) }),
  getGifts: () => request<Gift[]>("/api/gifts"),
  getWallet: (telegramId: number) => request<Wallet>(`/api/wallet/${telegramId}`),
  register: (telegramId: number, username: string | null) =>
    request<RegisterResult>("/api/register", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, username }),
    }),
  claimStarter: (telegramId: number) =>
    request<StarterResult>("/api/starter", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId }),
    }),
  upgrade: (body: { telegram_id: number; inventory_id: number; target_gift_id: number }) =>
    request<UpgradeResult>("/api/upgrade", { method: "POST", body: JSON.stringify(body) }),
  spend: (telegramId: number, amountStars: number, label: string) =>
    request<{ balance_stars: number; balance_ton: number }>("/api/wallet/spend", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, amount_stars: amountStars, label }),
    }),
  credit: (telegramId: number, amountStars: number, label: string) =>
    request<{ balance_stars: number; balance_ton: number }>("/api/wallet/credit", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, amount_stars: amountStars, label }),
    }),
  depositStars: (telegramId: number, stars: number) =>
    request<StarsInvoice>("/api/wallet/deposit/stars", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, stars }),
    }),
  depositTon: (telegramId: number, ton: number) =>
    request<TonInvoice>("/api/wallet/deposit/ton", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, ton }),
    }),
  checkTonDeposit: (telegramId: number, paymentId: number) =>
    request<TonCheckResult>("/api/wallet/deposit/ton/check", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, payment_id: paymentId }),
    }),
  createDeposit: (telegramId: number, amount: number) =>
    request<TonConnectDeposit>("/api/deposits", { method: "POST", body: JSON.stringify({ telegram_id: telegramId, amount }) }),
  getDeposit: (depositId: string, telegramId: number) =>
    request<{ status: "pending" | "credited" | "expired"; balance_stars?: number }>(`/api/deposits/${encodeURIComponent(depositId)}?telegram_id=${telegramId}`),
  getInventory: (telegramId: number) =>
    request<InventoryList>(`/api/inventory/${telegramId}`),
  openCase: (telegramId: number, caseId: string) =>
    request<{
      prize: Prize;
      bet_stars: number;
      prize_stars: number;
      sell_value_stars: number;
      inventory_id: number;
      balance_stars: number;
      balance_ton: number;
    }>("/api/cases/open", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, case_id: caseId }),
    }),
  getSnowfall: (telegramId: number) =>
    request<{ game: SnowfallGame | null }>(`/api/snowfall/current?telegram_id=${telegramId}`),
  startSnowfall: (telegramId: number, betStars: number) =>
    request<SnowfallGame>("/api/snowfall/start", {
      method: "POST", body: JSON.stringify({ telegram_id: telegramId, bet_stars: betStars }),
    }),
  hitSnowfall: (telegramId: number, sessionId: number) =>
    request<SnowfallGame>("/api/snowfall/hit", {
      method: "POST", body: JSON.stringify({ telegram_id: telegramId, session_id: sessionId }),
    }),
  openSnowfall: (telegramId: number, sessionId: number) =>
    request<SnowfallGame>("/api/snowfall/open", {
      method: "POST", body: JSON.stringify({ telegram_id: telegramId, session_id: sessionId }),
    }),
  sellInventoryItem: (telegramId: number, inventoryId: number) =>
    request<SellResult>("/api/inventory/sell-item", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, inventory_id: inventoryId }),
    }),
  sellAllInventory: (telegramId: number) =>
    request<SellAllResult>("/api/inventory/sell-all", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId }),
    }),
  withdrawInventoryItem: (telegramId: number, inventoryId: number) =>
    request<WithdrawResult>("/api/inventory/withdraw-item", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, inventory_id: inventoryId }),
    }),
  adminUsers: (telegramId: number, query: string) =>
    request<{ users: AdminUser[] }>(
      `/api/admin/users?telegram_id=${telegramId}&q=${encodeURIComponent(query)}`,
    ),
  setAdminRights: (telegramId: number, targetId: number, enabled: boolean) =>
    request<{ ok: boolean; user: AdminUser }>(
      `/api/admin/users/${targetId}/admin?telegram_id=${telegramId}`,
      { method: "POST", body: JSON.stringify({ enabled }) },
    ),
  setUserLuck: (telegramId: number, targetId: number, luck: number) =>
    request<{ ok: boolean; user: AdminUser }>(
      `/api/admin/users/${targetId}/luck?telegram_id=${telegramId}`,
      { method: "POST", body: JSON.stringify({ luck }) },
    ),
  addBalance: (telegramId: number, targetId: number, amountStars: number) =>
    request<{ ok: boolean; user: AdminUser }>(
      `/api/admin/users/${targetId}/balance?telegram_id=${telegramId}`,
      { method: "POST", body: JSON.stringify({ amount_stars: amountStars }) },
    ),
  adminSettings: (telegramId: number) =>
    request<AdminSettings>(`/api/admin/settings?telegram_id=${telegramId}`),
  setCaseLuck: (telegramId: number, caseId: string, luck: number) =>
    request<{ ok: boolean }>(
      `/api/admin/cases/${encodeURIComponent(caseId)}/luck?telegram_id=${telegramId}`,
      { method: "POST", body: JSON.stringify({ luck }) },
    ),
};
