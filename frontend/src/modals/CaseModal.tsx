import { useEffect, useMemo, useRef, useState } from "react";
import { chanceOf, drawPrize, getCase, paybackChance, rtpOf, type Prize } from "../data/cases";
import { fmt, fmtChance, rarityOf } from "../lib/format";
import { tg } from "../telegram";
import { Ton } from "../ui/Icons";
import Sheet from "../ui/Sheet";

export function PrizeArt({ prize, size = 64 }: { prize: Prize; size?: number }) {
  const [failed, setFailed] = useState(false);
  const r = rarityOf(prize.value);
  return (
    <span className="prize-art" data-r={r} style={{ width: size, height: size }}>
      {failed ? (
        <span style={{ fontSize: size * 0.62 }}>{prize.emoji}</span>
      ) : (
        <img src={`/prizes/${prize.image}`} alt="" draggable={false} onError={() => setFailed(true)} />
      )}
    </span>
  );
}

const ITEM_W = 96;
const GAP = 8;
const STEP = ITEM_W + GAP;
const REEL_LEN = 46;
const WIN_AT = 38;
const SPIN_MS = 5200;

type Phase = "idle" | "spinning" | "done";

export default function CaseModal({
  caseId,
  balance,
  onClose,
  onDeposit,
  onSpend,
  onWin,
}: {
  caseId: string;
  balance: number;
  onClose: () => void;
  onDeposit: () => void;
  onSpend: (amount: number, label: string) => void;
  onWin: (amount: number, label: string) => void;
}) {
  const def = getCase(caseId)!;
  const sorted = useMemo(() => [...def.prizes].sort((a, b) => b.value - a.value), [def]);
  const viewport = useRef<HTMLDivElement>(null);

  const idleReel = useMemo(() => Array.from({ length: REEL_LEN }, (_, i) => sorted[(i * 5) % sorted.length]), [sorted]);
  const [reel, setReel] = useState<Prize[]>(idleReel);
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prize, setPrize] = useState<Prize | null>(null);
  const [needDeposit, setNeedDeposit] = useState(false);

  const centerOffset = (i: number) => i * STEP + ITEM_W / 2 - (viewport.current?.clientWidth ?? 320) / 2;

  useEffect(() => {
    setX(centerOffset(3));
  }, []);

  function open() {
    if (phase === "spinning") return;
    if (balance < def.price) {
      setNeedDeposit(true);
      return;
    }
    setNeedDeposit(false);
    onSpend(def.price, `Кейс «${def.title}»`);
    const won = drawPrize(def);
    const next = Array.from({ length: REEL_LEN }, (_, i) =>
      i === WIN_AT ? won : sorted[Math.floor(Math.random() * sorted.length)],
    );
    setPrize(null);
    setPhase("spinning");
    tg?.HapticFeedback?.impactOccurred("medium");
    // сброс в начало без анимации, затем запуск
    setAnimating(false);
    setReel(next);
    setX(centerOffset(2));
    const jitter = (Math.random() - 0.5) * ITEM_W * 0.6;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setAnimating(true);
        setX(centerOffset(WIN_AT) + jitter);
      }),
    );
    window.setTimeout(() => {
      setPrize(won);
      setPhase("done");
      onWin(won.value, `Дроп: ${won.name}`);
      tg?.HapticFeedback?.notificationOccurred(won.value >= def.price ? "success" : "warning");
    }, SPIN_MS + 150);
  }

  const spinning = phase === "spinning";
  const diff = prize ? prize.value - def.price : 0;

  return (
    <Sheet title={def.title} onClose={onClose} locked={spinning} tall>
      <div className="reel" ref={viewport}>
        <div
          className="reel-track"
          style={{
            transform: `translate3d(${-x}px,0,0)`,
            transition: animating ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.72, 0.12, 1)` : "none",
          }}
        >
          {reel.map((p, i) => (
            <div key={i} className="reel-item" data-r={rarityOf(p.value)} style={{ width: ITEM_W, marginRight: GAP }}>
              <PrizeArt prize={p} size={60} />
              <span className="reel-val">
                <Ton size={12} />
                {fmt(p.value)}
              </span>
            </div>
          ))}
        </div>
        <i className="reel-laser" />
        <i className="reel-fade left" />
        <i className="reel-fade right" />
      </div>

      <div className="drop-result" aria-live="polite">
        {prize ? (
          <>
            <strong>{prize.name}</strong>
            <span className={diff >= 0 ? "plus" : "minus"}>
              {diff >= 0 ? "В плюсе на " : "В минусе на "}
              {fmt(Math.abs(diff))}
            </span>
            <small>Приз сразу зачислен на баланс: {fmt(prize.value)}</small>
          </>
        ) : (
          <span className="muted">{spinning ? "Крутим…" : "Нажми «Открыть», и рулетка выберет приз"}</span>
        )}
      </div>

      {needDeposit ? (
        <button className="btn primary wide" onClick={onDeposit}>
          Пополнить баланс
        </button>
      ) : (
        <button className="btn primary wide" onClick={open} disabled={spinning}>
          {spinning ? "Крутим…" : phase === "done" ? "Открыть ещё раз за" : "Открыть за"}
          {!spinning && (
            <>
              <Ton size={16} />
              {fmt(def.price)}
            </>
          )}
        </button>
      )}

      <h3 className="sub-title">Что может выпасть</h3>
      <div className="prize-grid">
        {sorted.map((p) => (
          <div key={p.id} className={`prize-tile${prize?.id === p.id && phase === "done" ? " hit" : ""}`} data-r={rarityOf(p.value)}>
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
        Шансы показаны так, как работает розыгрыш. Возврат игроку {rtpOf(def).toFixed(1).replace(".", ",")}%, шанс получить приз
        не меньше цены кейса {paybackChance(def).toFixed(2).replace(".", ",")}%.
      </p>
    </Sheet>
  );
}
