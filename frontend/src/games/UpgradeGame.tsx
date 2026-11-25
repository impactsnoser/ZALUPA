import { useCallback, useEffect, useMemo, useState } from "react";
import { api, MARGIN, type Gift, type UpgradeResult, type UserProfile } from "../api";
import { GIFTS } from "../data/gifts";
import { giftArtworkPath } from "../data/giftArtwork";
import { fmt } from "../lib/format";
import { getTelegramId, tg } from "../telegram";
import Sheet from "../ui/Sheet";

const EMOJI: Record<string, string> = { Мишка: "🧸", Сердце: "💖", Подарок: "🎁", Роза: "🌹", Торт: "🎂", Кубок: "🏆" };
const SPIN_MS = 5000;
const MYSTERY_QUESTIONS = [
  { left: 8, top: 9, size: 35, delay: 0.1 }, { left: 76, top: 6, size: 26, delay: 1.1 },
  { left: 91, top: 22, size: 39, delay: 0.6 }, { left: 4, top: 31, size: 28, delay: 1.6 },
  { left: 82, top: 43, size: 32, delay: 0.9 }, { left: 10, top: 56, size: 42, delay: 1.8 },
  { left: 93, top: 67, size: 27, delay: 0.3 }, { left: 23, top: 81, size: 29, delay: 1.3 },
  { left: 70, top: 89, size: 37, delay: 0.7 }, { left: 45, top: 3, size: 24, delay: 1.9 },
];

function giftsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "подарок";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "подарка";
  return "подарков";
}

type PickItem = { key: number; name: string; price: number; imageUrl: string | null };

function localGiftImage(name: string): string | null {
  const normalized = name.trim().toLocaleLowerCase();
  const gift = GIFTS.find((entry) => entry.name.trim().toLocaleLowerCase() === normalized);
  return gift ? `/prizes/${gift.image}` : giftArtworkPath(name);
}

function GiftArt({ name, imageUrl, className }: { name: string; imageUrl: string | null; className: string }) {
  const [useLocal, setUseLocal] = useState(!imageUrl);
  const [missing, setMissing] = useState(false);
  const local = localGiftImage(name);
  const src = useLocal ? local : imageUrl;
  if (src && !missing) return <img className={className} src={src} alt="" loading="lazy" onError={() => (useLocal ? setMissing(true) : setUseLocal(true))} />;
  return <span className={className}>{EMOJI[name] ?? "🎁"}</span>;
}

export default function UpgradeGame() {
  const telegramId = useMemo(() => getTelegramId(), []);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loadError, setLoadError] = useState("");
  const [fromIds, setFromIds] = useState<number[]>([]);
  const [toId, setToId] = useState<number | null>(null);
  const [mode, setMode] = useState<"normal" | "mystery">("normal");
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"ready" | "rolling" | "win" | "lose">("ready");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<UpgradeResult | null>(null);
  const [error, setError] = useState("");
  const [starterLoading, setStarterLoading] = useState(false);
  const [returnFactor, setReturnFactor] = useState(0.8);

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

  useEffect(() => {
    void api.getGameSettings().then((settings) => setReturnFactor(settings.global_return_factor)).catch(() => setReturnFactor(0.8));
  }, []);

  async function claimStarter() {
    if (starterLoading) return;
    setStarterLoading(true);
    setError("");
    try {
      await api.claimStarter(telegramId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить подарок");
    } finally {
      setStarterLoading(false);
    }
  }

  const fromItems = user?.inventory.filter((item) => fromIds.includes(item.inventory_id)) ?? [];
  const fromValue = fromItems.reduce((sum, item) => sum + item.price_stars, 0);
  const firstFromItem = fromItems[0] ?? null;
  const toGift = fromItems.length > 0 && toId !== null ? (gifts.find((g) => g.id === toId && g.price_stars > fromValue) ?? null) : null;
  const mysteryTargets = gifts.filter((gift) => gift.is_nft);
  const mysteryPreview = mysteryTargets.length > 0
    ? mysteryTargets.reduce((sum, gift) => sum + Math.min(1, (fromValue / gift.price_stars) * MARGIN * returnFactor), 0) / mysteryTargets.length
    : 0;
  const preview = mode === "mystery"
    ? mysteryPreview
    : firstFromItem && toGift ? (fromValue / toGift.price_stars) * MARGIN * returnFactor : 0;
  const chance = result ? result.chance : preview;
  const pct = chance * 100;
  const rolling = state === "rolling";
  const canUpgrade = fromItems.length > 0 && (mode === "mystery" ? mysteryTargets.length > 0 : Boolean(toGift));
  const ringRest = mode === "mystery" ? "rgba(211, 180, 255, .16)" : "rgba(255,59,82,.22)";
  const ringFill = mode === "mystery" ? "#cf9cff" : "#ffd98a";

  async function upgrade() {
    if (!canUpgrade || rolling || (mode === "normal" && !toGift)) return;
    setError("");
    setResult(null);
    setState("rolling");
    tg?.HapticFeedback?.impactOccurred("medium");
    try {
      const res = await api.upgrade({
        telegram_id: telegramId,
        inventory_ids: fromIds,
        ...(mode === "mystery" ? { mystery: true } : { target_gift_id: toGift!.id }),
      });
      setResult(res);
      setRotation((prev) => Math.ceil(prev / 360) * 360 + 360 * 5 + res.roll * 360);
      await new Promise((r) => window.setTimeout(r, SPIN_MS + 250));
      setState(res.win ? "win" : "lose");
      tg?.HapticFeedback?.notificationOccurred(res.win ? "success" : "error");
      setFromIds([]);
      setToId(null);
      await load();
    } catch (e) {
      setState("ready");
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const fromList: PickItem[] = (user?.inventory ?? []).map((i) => ({ key: i.inventory_id, name: i.name, price: i.price_stars, imageUrl: i.image_url }));
  const toList: PickItem[] = fromItems.length > 0
    ? gifts.filter((g) => g.price_stars > fromValue).map((g) => ({ key: g.id, name: g.name, price: g.price_stars, imageUrl: g.image_url }))
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

  const slot = (label: string, name: string | null, price: number | null, imageUrl: string | null, hint: string, onClick: () => void, disabled: boolean) => (
    <button className={`slot${name ? " filled" : ""}`} onClick={onClick} disabled={disabled}>
      <small className="slot-label">{label}</small>
      {name ? (
        <>
          <GiftArt className="slot-art" name={name} imageUrl={imageUrl} />
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
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle ? list.filter((it) => it.name.toLocaleLowerCase().includes(needle)) : list;

  const stateLabel =
    rolling ? "Крутим…" : state === "win" ? "Победа" : state === "lose" ? "Не повезло" : mode === "mystery" ? (mysteryTargets.length ? "NFT выберется случайно" : "Каталог NFT пуст") : toGift ? "Готов к запуску" : "Выбери подарки";

  return (
    <div className={`upg${mode === "mystery" ? " upg-mystery" : ""}`}>
      {mode === "mystery" && (
        <div className="mystery-questions" aria-hidden="true">
          {MYSTERY_QUESTIONS.map((question, index) => (
            <span key={index} style={{ left: `${question.left}%`, top: `${question.top}%`, fontSize: question.size, animationDelay: `${-question.delay}s` }}>?</span>
          ))}
        </div>
      )}
      <div className="upg-mode-switch" role="tablist" aria-label="Режим апгрейда">
        <button type="button" role="tab" aria-selected={mode === "normal"} className={mode === "normal" ? "active" : ""} disabled={rolling} onClick={() => { setMode("normal"); setResult(null); setState("ready"); setError(""); }}>Обычный</button>
        <button type="button" role="tab" aria-selected={mode === "mystery"} className={mode === "mystery" ? "active" : ""} disabled={rolling} onClick={() => { setMode("mystery"); setToId(null); setResult(null); setState("ready"); setError(""); }}>Мистери</button>
      </div>
      <div className={`upg-stage ${state}`}>
        <div className="upg-aura" aria-hidden="true" />
        <div className={`wheel ${state}`}>
          <div className="wheel-head">
            <span className="wheel-kicker">{mode === "mystery" ? "MYSTERY UPGRADE" : "АПГРЕЙД"}</span>
            <span className={`wheel-status ${state}`}>{stateLabel}</span>
          </div>
          <div
            className="wheel-ring"
            style={{ background: `conic-gradient(from 0deg, ${ringFill} 0deg ${pct * 3.6}deg, ${ringRest} ${pct * 3.6}deg 360deg)` }}
          >
            <div className="wheel-core">
              <b>{rolling ? "…" : state === "win" ? "Победа" : state === "lose" ? "Не вышло" : canUpgrade ? `${fmt(pct)}%` : mode === "mystery" && fromItems.length ? "—" : "?"}</b>
              <small>{rolling ? "крутим" : canUpgrade || result ? (mode === "mystery" ? "средний шанс" : "шанс успеха") : mode === "mystery" ? "выбери ставку" : "два подарка"}</small>
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
        </div>
      </div>

      <div className="swap">
        {slot(`Твои подарки · ${fromItems.length}/6`, fromItems.length ? (fromItems.length === 1 ? firstFromItem!.name : `${fromItems.length} подарков выбрано`) : null, fromItems.length ? fromValue : null, firstFromItem?.image_url ?? null, "Выбери до 6 из инвентаря", () => (setQuery(""), setPicker("from")), rolling)}
        <span className="swap-arrow" aria-hidden="true">⇄</span>
        {mode === "mystery" ? (
          <div className={`slot mystery-target${result?.win && result.reward ? " revealed" : ""}`}>
            <small className="slot-label">СЛУЧАЙНАЯ ЦЕЛЬ</small>
            {result?.win && result.reward ? (
              <>
                <GiftArt className="slot-art" name={result.reward.name} imageUrl={result.reward.image_url} />
                <b>{result.reward.name}</b>
                <em>⭐ {fmt(result.reward.price_stars)}</em>
              </>
            ) : (
              <>
                <span className="mystery-target-mark">?</span>
                <b>{state === "lose" ? "Не выпало" : "Любой NFT"}</b>
                <em>{mysteryTargets.length} NFT в пуле</em>
              </>
            )}
          </div>
        ) : slot("Хочу получить", toGift?.name ?? null, toGift?.price_stars ?? null, toGift?.image_url ?? null, fromItems.length ? "Выбери цель дороже ставки" : "Сначала выбери подарки", () => (setQuery(""), setPicker("to")), rolling || fromItems.length === 0)}
      </div>

      {canUpgrade && !result && (
        <>
          <div className="upg-odds">
            <span>{mode === "mystery" ? "Средний шанс" : "Шанс успеха"}</span>
            <div className="upg-bar">
              <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </div>
            <b>{fmt(pct)}%</b>
          </div>
          <small className="muted">{mode === "mystery" ? `Цель выбирается случайно из всех ${mysteryTargets.length} NFT каталога. Дорогие NFT выпадают с меньшим шансом.` : `Ставка — ${fromItems.length} ${giftsWord(fromItems.length)} общей стоимостью ⭐ ${fmt(fromValue)}.`} При неудаче все выбранные подарки сгорят.</small>
        </>
      )}

      {mode === "mystery" && result && !rolling && result.win && result.reward && (
        <div className="mystery-win-card">
          <small>ТВОЙ NFT</small>
          <GiftArt className="mystery-win-art" name={result.reward.name} imageUrl={result.reward.image_url} />
          <b>{result.reward.name}</b>
          <em>⭐ {fmt(result.reward.price_stars)}</em>
        </div>
      )}

      {result && !rolling && (
        <small className="upg-roll muted">
          Бросок {(result.roll * 100).toFixed(2).replace(".", ",")}%, нужно меньше {(result.chance * 100).toFixed(2).replace(".", ",")}%
        </small>
      )}

      {error && <p className="notice bad">{error}</p>}
      {user && user.inventory.length === 0 && (
        <div className="notice">
          <p>Инвентарь пуст — улучшать нечего.</p>
          <button className="btn primary wide" onClick={claimStarter} disabled={starterLoading}>
            {starterLoading ? "Выдаём…" : "Получить стартовый подарок"}
          </button>
        </div>
      )}

      <button className={`btn primary wide upg-cta${mode === "mystery" ? " mystery-cta" : ""}`} onClick={upgrade} disabled={!canUpgrade || rolling}>
        {rolling ? "Крутим…" : mode === "mystery" ? (canUpgrade ? `Крутить мистери · ${fmt(pct)}%` : "Выбери подарок для ставки") : toGift ? `Улучшить с шансом ${fmt(pct)}%` : "Улучшить"}
      </button>

      {picker && (
        <Sheet title={picker === "from" ? "Твой инвентарь" : "Каталог, только дороже"} onClose={() => setPicker(null)}>
          {picker === "from" && (
            <p className="fine upg-pick-summary">
              Выбрано {fromItems.length} из 6 · общая ставка: ⭐ {fmt(fromValue)}
            </p>
          )}
          <div className="pick-tools">
            <input
              className="pick-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Быстрый поиск подарка…"
              inputMode="search"
            />
            {query && (
              <button className="pick-clear" type="button" onClick={() => setQuery("")} aria-label="Очистить">
                ×
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <p className="empty">{list.length === 0 ? "Ничего нет" : "Ничего не найдено"}</p>
          ) : (
            <div className="pick-scroll">
              <div className="pick-grid">
                {filtered.map((it) => (
                  <button
                    key={it.key}
                    className={`pick${picker === "from" && fromIds.includes(it.key) ? " selected" : ""}`}
                    disabled={picker === "from" && fromIds.length >= 6 && !fromIds.includes(it.key)}
                    onClick={() => {
                      if (picker === "from") {
                        setFromIds((current) => current.includes(it.key)
                          ? current.filter((id) => id !== it.key)
                          : current.length < 6 ? [...current, it.key] : current);
                        setToId(null);
                        setState("ready");
                        setResult(null);
                      } else {
                        setToId(it.key);
                        setState("ready");
                        setResult(null);
                        setPicker(null);
                      }
                    }}
                  >
                    <GiftArt className="pick-art" name={it.name} imageUrl={it.imageUrl} />
                    <b>{it.name}</b>
                    <em>⭐ {it.price}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
          {picker === "from" && (
            <button className="btn primary wide upg-pick-done" onClick={() => setPicker(null)} disabled={fromItems.length === 0}>
              Готово · {fromItems.length} выбрано
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}
