import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { SellResult } from "../api";
import { chanceOf, getCase, paybackChance, rtpOf, type Prize } from "../data/cases";
import { fmt, fmtChance, rarityOf } from "../lib/format";
import { tg } from "../telegram";
import { Ton } from "../ui/Icons";
import QuickScroll from "../ui/QuickScroll";

export function PrizeArt({ prize, size = 64 }: { prize: Prize; size?: number }) {
  const [failed, setFailed] = useState(false);
  const r = rarityOf(prize.value);
  return (
    <span className="prize-art" data-r={r} style={{ width: size, height: size }}>
      {failed ? (
        <span style={{ fontSize: size * 0.34 }}>🎁</span>
      ) : (
        <img src={`/prizes/${prize.image}`} alt="" draggable={false} onError={() => setFailed(true)} />
      )}
    </span>
  );
}

// Размер карточки и отступ должны совпадать с CSS; лента движется сверху вниз.
const ITEM_W = 168;
const ITEM_H = 112;
const GAP = 8;
const STEP = ITEM_H + GAP;
const REEL_LEN = 46;
const WIN_AT = 12;
const SPIN_START_AT = 38;
const ACTIVE_AT = 2;
const SPIN_MS = 3600;
const BULK_SPIN_MS = 3200;
const BULK_REEL_LEN = 23;
const BULK_WIN_AT = 19;
const BULK_ITEM_H = 64;
const BULK_GAP = 6;
const BULK_STEP = BULK_ITEM_H + BULK_GAP;

type Phase = "idle" | "spinning" | "done";

type OpenCaseResponse = {
  prize: Prize;
  bet_stars: number;
  prize_stars: number;
  sell_value_stars: number;
  inventory_id: number;
  balance_stars: number;
  balance_ton: number;
};

function BulkReel({ prize, sorted, reelIndex }: { prize: Prize; sorted: Prize[]; reelIndex: number }) {
  const items = useMemo(() => Array.from({ length: BULK_REEL_LEN }, (_, index) =>
    index === BULK_WIN_AT ? prize : sorted[(index * 7 + reelIndex * 11) % sorted.length],
  ), [prize, reelIndex, sorted]);
  return (
    <div className="bulk-reel" data-r={rarityOf(prize.value)}>
      <div className="bulk-reel-window">
        <div className="bulk-reel-track" style={{ ["--bulk-reel-end" as string]: `${-(BULK_WIN_AT * BULK_STEP - 8)}px` }}>
          {items.map((item, index) => (
            <div className="bulk-reel-item" key={`${item.id}-${index}`} style={{ height: BULK_ITEM_H, marginBottom: BULK_GAP }}>
              <PrizeArt prize={item} size={42} />
              <b>{item.name}</b>
              <small>{fmt(item.value)} TON</small>
            </div>
          ))}
        </div>
        <span className="bulk-reel-marker" aria-hidden="true" />
      </div>
    </div>
  );
}

function BulkReelPlaceholders({ count }: { count: number }) {
  return <div className="bulk-reels is-loading" aria-label={`Подготавливаем ${count} рулетки`}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="bulk-reel-placeholder"><span>🎁</span><small>Открываем</small></div>)}
  </div>;
}

export default function CaseModal({
  caseId,
  telegramId,
  balance,
  onClose,
  onDeposit,
  onCredited,
}: {
  caseId: string;
  telegramId: number;
  balance: number;
  onClose: () => void;
  onDeposit: () => void;
  onCredited: () => void;
}) {
  const def = getCase(caseId)!;
  const sorted = useMemo(() => [...def.prizes].sort((a, b) => b.value - a.value), [def]);
  const viewport = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLElement>(null);

  // Лента строится окном вокруг выбранного приза: он всегда стоит в позиции
  // ACTIVE_AT, поэтому его легко подсветить и отцентрировать.
  const makeReel = (start: number) =>
    Array.from(
      { length: REEL_LEN },
      (_, i) => sorted[(start + i - ACTIVE_AT + sorted.length * 4) % sorted.length],
    );

  const idleReel = useMemo(() => makeReel(0), [sorted]);
  const [reel, setReel] = useState<Prize[]>(idleReel);
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prize, setPrize] = useState<Prize | null>(null);
  const [prizeStars, setPrizeStars] = useState(0);
  const [needDeposit, setNeedDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [activeSlot, setActiveSlot] = useState(ACTIVE_AT);
  // Мульти-открытие: до 5 кейсов за раз.
  const [qty, setQty] = useState(1);
  const [bulk, setBulk] = useState<Prize[]>([]);
  const [bulkSpinning, setBulkSpinning] = useState(false);
  const [openedInventoryId, setOpenedInventoryId] = useState<number | null>(null);
  const [sellValueStars, setSellValueStars] = useState(0);
  const [soldStars, setSoldStars] = useState<number | null>(null);
  const [prizeAction, setPrizeAction] = useState<"pending" | "kept" | "sold">("pending");
  const [sellPrizeBusy, setSellPrizeBusy] = useState(false);

  const centerOffset = (i: number) => i * STEP + ITEM_H / 2 - (viewport.current?.clientHeight ?? 280) / 2;

  function selectPrize(next: number) {
    if (phase === "spinning") return;
    const index = (next + sorted.length) % sorted.length;
    setSelected(index);
    setActiveSlot(ACTIVE_AT);
    setAnimating(false);
    setReel(makeReel(index));
    setX(centerOffset(ACTIVE_AT));
  }

  // До первой отрисовки центрируем ленту, чтобы не было рывка с левого края.
  useLayoutEffect(() => {
    setX(centerOffset(ACTIVE_AT));
  }, []);

  // Esc закрывает экран, если рулетка не крутится.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "spinning") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  async function open() {
    if (phase === "spinning" || busy) return;
    if (balance < def.price) {
      setNeedDeposit(true);
      return;
    }
    setNeedDeposit(false);
    setError(null);
    setBusy(true);
    setBulk([]);
    setOpenedInventoryId(null);
    setSoldStars(null);
    setPrizeAction("pending");

    // Результат считает сервер: он же списывает ставку и кладёт предмет
    // в инвентарь. Клиент не может подделать приз через консоль.
    let result: OpenCaseResponse;
    try {
      result = await api.openCase(telegramId, def.id);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Не удалось открыть кейс");
      return;
    }

    const won = result.prize;
    setOpenedInventoryId(result.inventory_id);
    setSellValueStars(result.sell_value_stars);
    const next = Array.from({ length: REEL_LEN }, (_, i) =>
      i === WIN_AT ? won : sorted[Math.floor(Math.random() * sorted.length)],
    );
    setPrize(null);
    setPrizeStars(result.prize_stars);
    setPhase("spinning");
    setActiveSlot(WIN_AT);
    tg?.HapticFeedback?.impactOccurred("medium");
    // сброс в начало без анимации, затем запуск
    setAnimating(false);
    setReel(next);
    setX(centerOffset(SPIN_START_AT));
    // Небольшой сдвиг, чтобы остановка выглядела естественно, но выигрышный
    // предмет всё равно оставался в центре витрины.
    const jitter = (Math.random() - 0.5) * ITEM_H * 0.3;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setAnimating(true);
        setX(centerOffset(WIN_AT) + jitter);
      }),
    );
    window.setTimeout(() => {
      setPrize(won);
      setPhase("done");
      setBusy(false);
      const wonIndex = sorted.findIndex((item) => item.id === won.id);
      setSelected(wonIndex);
      setActiveSlot(ACTIVE_AT);
        setAnimating(false);
        setReel(makeReel(wonIndex));
        setX(centerOffset(ACTIVE_AT));
      // Обновляем баланс и историю в родителе.
      void onCredited();
      tg?.HapticFeedback?.notificationOccurred(won.value >= def.price ? "success" : "warning");
    }, SPIN_MS + 150);
  }

  // Открытие сразу нескольких кейсов: сервер открывает по одному,
  // поэтому вызываем его последовательно и копим результаты.
  async function openMany() {
    if (phase === "spinning" || busy) return;
    if (balance < def.price * qty) {
      setNeedDeposit(true);
      return;
    }
    setNeedDeposit(false);
    setError(null);
    setBusy(true);
    setPhase("spinning");
    setPrize(null);
    setBulk([]);
    setBulkSpinning(false);
    const got: Prize[] = [];
    const animateResults = (results: Prize[]) => {
      setBulk(results);
      setBulkSpinning(true);
      window.setTimeout(() => {
        setBulkSpinning(false);
        setPhase("done");
        setBusy(false);
        tg?.HapticFeedback?.notificationOccurred("success");
        void onCredited();
      }, BULK_SPIN_MS + 100);
    };
    try {
      for (let i = 0; i < qty; i += 1) {
        const res = await api.openCase(telegramId, def.id);
        got.push(res.prize);
        tg?.HapticFeedback?.impactOccurred("light");
      }
      animateResults(got);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть кейсы");
      if (got.length) animateResults(got);
      else { setPhase("idle"); setBusy(false); }
    }
  }

  function handleBuy() {
    if (qty > 1) void openMany();
    else void open();
  }

  async function sellOpenedPrize() {
    if (openedInventoryId === null || sellPrizeBusy) return;
    setSellPrizeBusy(true);
    setError(null);
    try {
      const result: SellResult = await api.sellInventoryItem(telegramId, openedInventoryId);
      setSoldStars(result.sold_stars);
      setPrizeAction("sold");
      void onCredited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось продать подарок");
    } finally {
      setSellPrizeBusy(false);
    }
  }

  const spinning = phase === "spinning";
  const qtyWord = qty === 1 ? "кейс" : qty >= 5 ? "кейсов" : "кейса";
  const bulkWord = bulk.length === 1 ? "предмет" : bulk.length >= 5 ? "предметов" : "предмета";
  const diff = prize ? prize.value - def.price : 0;
  const total = sorted.length;
  const topIndex = (selected % total) + 1;
  const bottomIndex = ((selected + 2) % total) + 1;
  const showBulkLoading = qty > 1 && busy && bulk.length === 0;

  return (
    <section className="case-screen" aria-label={def.title} ref={screen}>
      <QuickScroll containerRef={screen} />
      <header className="case-screen-head">
        <button className="case-back" onClick={onClose} disabled={spinning} aria-label="Назад">‹</button>
        <span>КЕЙСЫ</span>
        <div className="wallet case-wallet"><Ton size={18} /><b>{fmt(balance)}</b><button onClick={onDeposit} aria-label="Пополнить">＋</button></div>
      </header>
      <h1 className="case-screen-title">
        {def.title === "Снежный кейс" ? "Тёмная материя" : def.title}
      </h1>
      {error && <p className="notice bad">{error}</p>}

      {bulk.length === 0 && !showBulkLoading && (
      <div className={`case-showcase${spinning ? " is-spinning" : ""}${phase === "done" ? " is-done" : ""}`} ref={viewport}>
        <span className="showcase-index top">{String(topIndex).padStart(2, "0")}</span>
        <span className="showcase-index bottom">{String(bottomIndex).padStart(2, "0")}</span>
        <div
          className="showcase-track"
          aria-hidden={phase === "done"}
          style={{
            transform: `translate3d(0,${-x}px,0)`,
            transition: animating ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.72, 0.12, 1)` : "none",
            visibility: phase === "done" ? "hidden" : "visible",
          }}
        >
          {reel.map((p, i) => (
            <div
              key={`${p.id}-${i}`}
              className={`showcase-item${i === activeSlot ? " active" : ""}`}
              data-r={rarityOf(p.value)}
              style={{ width: ITEM_W, height: ITEM_H, marginBottom: GAP }}
            >
              <PrizeArt prize={p} size={60} />
              <b>{p.name}</b><small>{fmt(p.value)} TON</small>
            </div>
          ))}
        </div>
        {phase === "done" && prize && (
          <div className="showcase-result-item" aria-label={`Выпал предмет: ${prize.name}`}>
            <PrizeArt prize={prize} size={64} />
            <b>{prize.name}</b>
            <small>{fmt(prize.value)} TON</small>
          </div>
        )}
        <button
          className="showcase-arrow left"
          onClick={() => selectPrize(selected - 1)}
          disabled={spinning}
          aria-label="Предыдущий предмет"
        >
          →
        </button>
        <button
          className="showcase-arrow right"
          onClick={() => selectPrize(selected + 1)}
          disabled={spinning}
          aria-label="Следующий предмет"
        >
          ←
        </button>
      </div>
      )}

      {showBulkLoading && <BulkReelPlaceholders count={qty} />}

      {bulk.length > 0 && bulkSpinning && (
        <div className="bulk-opening" aria-live="polite">
          <strong>Открываем {bulk.length} кейсов</strong>
          <div className="bulk-reels">
            {bulk.map((p, i) => <BulkReel key={`${p.id}-${i}`} prize={p} sorted={sorted} reelIndex={i} />)}
          </div>
        </div>
      )}

      {bulk.length > 0 && !bulkSpinning && (
        <div className="bulk-results" aria-live="polite">
          {bulk.map((p, i) => (
            <div key={`${p.id}-${i}`} className="bulk-item" data-r={rarityOf(p.value)}>
              <PrizeArt prize={p} size={56} />
              <b>{p.name}</b>
              <small>{fmt(p.value)} TON</small>
            </div>
          ))}
        </div>
      )}

      <div className="drop-result" aria-live="polite">
        {showBulkLoading ? (
          <strong>Готовим {qty} рулетки…</strong>
        ) : bulk.length > 0 && bulkSpinning ? (
          <strong>Каждый кейс открывается…</strong>
        ) : bulk.length > 0 ? (
          <>
            <strong>Выпало {bulk.length} {bulkWord}</strong>
            <small>Все предметы добавлены в инвентарь — продать или вывести их можно в профиле.</small>
          </>
        ) : prize ? (
          <>
            <strong>{prize.name}</strong>
            <span className={diff >= 0 ? "plus" : "minus"}>
              {diff >= 0 ? "В плюсе на " : "В минусе на "}
              {fmt(Math.abs(diff))}
            </span>
            <small>
              {prizeAction === "sold"
                ? `Продано за ${soldStars ?? sellValueStars} ⭐. Баланс обновлён.`
                : prizeAction === "kept"
                  ? `≈ ${prizeStars} ⭐. Подарок оставлен в инвентаре.`
                  : `≈ ${prizeStars} ⭐. Выбери: оставить подарок или продать сразу.`}
            </small>
          </>
        ) : (
          <span className="muted">
            {spinning ? "Открываем кейс…" : "Один кейс. Один новый предмет."}
          </span>
        )}
      </div>

      {prize && openedInventoryId !== null && prizeAction === "pending" && (
        <div className="case-prize-actions">
          <button className="case-prize-action keep" onClick={() => setPrizeAction("kept")} disabled={sellPrizeBusy}>
            Оставить в инвентаре
          </button>
          <button className="case-prize-action sell" onClick={sellOpenedPrize} disabled={sellPrizeBusy}>
            {sellPrizeBusy ? "Продаём…" : `Продать за ${fmt(sellValueStars)} ⭐`}
          </button>
        </div>
      )}

      <div className="case-qty" role="group" aria-label="Сколько кейсов открыть за раз">
        <span>За раз</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`qty-chip${qty === n ? " active" : ""}`}
            onClick={() => setQty(n)}
            disabled={spinning || busy}
          >
            ×{n}
          </button>
        ))}
      </div>

      {needDeposit ? (
        <button className="case-buy wide" onClick={onDeposit}>
          Пополнить баланс
        </button>
      ) : (
        <button className="case-buy wide" onClick={handleBuy} disabled={spinning || busy}>
          {busy && qty > 1
            ? `Открываем ${qty}…`
            : spinning
              ? "Открываем…"
              : qty === 1
                ? phase === "done" && bulk.length === 0
                  ? "Открыть ещё раз за"
                  : "Открыть кейс за"
                : `Открыть ${qty} ${qtyWord} за`}
          {!spinning && !(busy && qty > 1) && (
            <>
              <Ton size={16} />
              {fmt(def.price * qty)}
            </>
          )}
        </button>
      )}

      <p className="case-inventory-note">ⓘ Предмет появится в инвентаре</p>
      <h3 className="sub-title case-prizes-title">Что может выпасть</h3>
      <div className="prize-grid">
        {sorted.map((p) => (
          <div
            key={p.id}
            className={`prize-tile${prize?.id === p.id && phase === "done" ? " hit" : ""}`}
            data-r={rarityOf(p.value)}
          >
            <span className="prize-tile-val">
              <Ton size={11} />
              {fmt(p.value)}
            </span>
            <PrizeArt prize={p} size={52} />
            <span className="prize-tile-chance">{fmtChance(chanceOf(p))}%</span>
          </div>
        ))}
      </div>
      <p className="fine">
        Розыгрыш идёт на сервере. Возврат игроку{" "}
        {rtpOf(def).toFixed(1).replace(".", ",")}%, шанс получить приз не меньше цены кейса{" "}
        {paybackChance(def).toFixed(2).replace(".", ",")}%.
      </p>
    </section>
  );
}
