const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      ...init,
    });
  } catch {
    throw new Error("Нет связи с сервером. Бэкенд запущен?");
  }
  if (!res.ok) {
    let detail = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* не JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getUser: (telegramId: number) => request<UserProfile>(`/api/user/${telegramId}`),
  getGifts: () => request<Gift[]>("/api/gifts"),
  upgrade: (body: { telegram_id: number; inventory_id: number; target_gift_id: number }) =>
    request<UpgradeResult>("/api/upgrade", { method: "POST", body: JSON.stringify(body) }),
};
