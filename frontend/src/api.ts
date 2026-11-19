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
  gift_id: number;
  name: string;
  price_stars: number;
  image_url: string | null;
  is_nft: boolean;
}

export interface UserProfile {
  id: number;
  telegram_id: number;
  username: string | null;
  balance_stars: number;
  inventory: InventoryItem[];
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
  getGifts: () => request<Gift[]>("/api/gifts"),
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
};
