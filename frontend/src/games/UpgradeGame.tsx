import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MARGIN, type Gift, type UpgradeResult, type UserProfile } from "../api";
import { fmt } from "../lib/format";
import { getTelegramId, tg } from "../telegram";
import Sheet from "../ui/Sheet";

const EMOJI: Record<string, string> = { Мишка: "🧸", Сердце: "💖", Подарок: "🎁", Роза: "🌹", Торт: "🎂", Кубок: "🏆" };
const SPIN_MS = 5000;

type PickItem = { key: number; name: string; price: number };

export default function UpgradeGame() {
  const telegramId = useMemo(() => getTelegramId(), []);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loadError, setLoadError] = useState("");
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [state, setState] = useState<"ready" | "rolling" | "win" | "lose">("ready");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<UpgradeResult | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      let u: UserProfile;
      try {
        u = await api.getUser(telegramId);
      } catch (e) {
        // Новый Telegram-пользователь: регистрируем и выдаём стартовый подарок
        if (!(e instanceof Error) || !e.message.includes("Пользователь не найден")) throw e;
        await api.register(telegramId, tg?.initDataUnsafe?.user?.username ?? null);
        u = await api.getUser(telegramId);
      }
      const g = await api.getGifts();
      setUser(u);
      setGifts(g);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, [telegramId]);

  useEffect(() => {
    load();
  }, [load]);

  const fromItem = user?.inventory.find((i) => i.inventory_id === fromId) ?? null;
  const toGift = fromItem && toId !== null ? (gifts.find((g) => g.id === toId && g.price_stars > fromItem.price_stars) ?? null) : null;
  const preview = fromItem && toGift ? (fromItem.price_stars / toGift.price_stars) * MARGIN : 0;
  const chance = result ? result.chance : preview;
  const pct = chance * 100;
  const rolling = state === "rolling";

  async function upgrade() {
    if (!fromItem || !toGift || rolling) return;
    setError("");
    setResult(null);
    setState("rolling");
    tg?.HapticFeedback?.impactOccurred("medium");
    try {
      const res = await api.upgrade({ telegram_id: telegramId, inventory_id: fromItem.inventory_id, target_gift_id: toGift.id });
      setResult(res);
      setRotation((prev) => Math.ceil(prev / 360) * 360 + 360 * 5 + res.roll * 360);
      await new Promise((r) => window.setTimeout(r, SPIN_MS + 250));
      setState(res.win ? "win" : "lose");
      tg?.HapticFeedback?.notificationOccurred(res.win ? "success" : "error");
      setFromId(null);
      setToId(null);
      await load();
    } catch (e) {
      setState("ready");
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const fromList: PickItem[] = (user?.inventory ?? []).map((i) => ({ key: i.inventory_id, name: i.name, price: i.price_stars }));
  const toList: PickItem[] = fromItem
    ? gifts.filter((g) => g.price_stars > fromItem.price_stars).map((g) => ({ key: g.id, name: g.name, price: g.price_stars }))
    : [];

  if (loadError) {
    return (
      <div className="stack center">
        <p className="lead">{loadError}</p>
        <small className="muted">ID в Telegram: {telegramId}</small>
        <button className="btn primary" onClick={load}>
          Повторить
        </button>
      </div>
    );
  }

  const slot = (label: string, name: string | null, price: number | null, hint: string, onClick: () => void, disabled: boolean) => (
    <button className={`slot${name ? " filled" : ""}`} onClick={onClick} disabled={disabled}>
      <small>{label}</small>
      {name ? (
        <>
          <span className="slot-emoji">{EMOJI[name] ?? "🎁"}</span>
          <b>{name}</b>
          <em>⭐ {price}</em>
        </>
      ) : (
        <>
          <span className="slot-emoji dim">+</span>
          <span className="slot-hint">{hint}</span>
        </>
      )}
    </button>
  );

  const list = picker === "from" ? fromList : toList;

  return (
    <div className="upg">
      <div className={`wheel ${state}`}>
        <div
          className="wheel-ring"
          style={{ background: `conic-gradient(from 0deg, var(--foil) 0deg ${pct * 3.6}deg, rgba(232,52,74,.34) ${pct * 3.6}deg 360deg)` }}
        >
          <div className="wheel-core">
            <b>{rolling ? "…" : state === "win" ? "Победа" : state === "lose" ? "Не вышло" : toGift ? `${fmt(pct)}%` : "Выбери"}</b>
            <small>{rolling ? "крутим" : toGift || result ? "шанс" : "два подарка"}</small>
          </div>
          <div
            className="wheel-spinner"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: rolling && result ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.72, 0.12, 1)` : "none",
            }}
          >
            <i />
          </div>
        </div>
        {result && !rolling && (
          <small className="muted">
            Бросок {(result.roll * 100).toFixed(2).replace(".", ",")}%, нужно меньше {(result.chance * 100).toFixed(2).replace(".", ",")}%
          </small>
        )}
      </div>

      <div className="swap">
        {slot("Твой подарок", fromItem?.name ?? null, fromItem?.price_stars ?? null, "Выбери из инвентаря", () => setPicker("from"), rolling)}
        <span className="swap-arrow">→</span>
        {slot("Хочу получить", toGift?.name ?? null, toGift?.price_stars ?? null, fromItem ? "Выбери цель" : "Сначала свой", () => setPicker("to"), rolling || !fromItem)}
      </div>

      {error && <p className="notice bad">{error}</p>}
      {user && user.inventory.length === 0 && <p className="notice">Инвентарь пуст, улучшать нечего.</p>}

      <button className="btn primary wide" onClick={upgrade} disabled={!fromItem || !toGift || rolling}>
        {rolling ? "Крутим…" : toGift ? `Улучшить с шансом ${fmt(pct)}%` : "Улучшить"}
      </button>

      {picker && (
        <Sheet title={picker === "from" ? "Твой инвентарь" : "Каталог, только дороже"} onClose={() => setPicker(null)}>
          {list.length === 0 ? (
            <p className="empty">Ничего нет</p>
          ) : (
            <div className="pick-grid">
              {list.map((it) => (
                <button
                  key={it.key}
                  className="pick"
                  onClick={() => {
                    if (picker === "from") {
                      setFromId(it.key);
                      setToId(null);
                    } else setToId(it.key);
                    setState("ready");
                    setResult(null);
                    setPicker(null);
                  }}
                >
                  <span className="slot-emoji">{EMOJI[it.name] ?? "🎁"}</span>
                  <b>{it.name}</b>
                  <em>⭐ {it.price}</em>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
