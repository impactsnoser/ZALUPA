import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { getCase, type Prize } from "../data/cases";
import { fmt, rarityOf } from "../lib/format";
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
        <img
          src={`/prizes/${prize.image}`}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
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

  const idleReel = useMemo(
    () => Array.from({ length: REEL_LEN }, (_, i) => sorted[(i * 5) % sorted.length]),
    [sorted],
  );
  const [reel, setReel] = useState<Prize[]>(idleReel);
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prize, setPrize] = useState<Prize | null>(null);
  const [needDeposit, setNeedDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const centerOffset = (i: number) => i * STEP + ITEM_W / 2 - (viewport.current?.clientWidth ?? 320) / 2;

  useEffect(() => {
    setX(centerOffset(3));
  }, []);

  async function open() {
    if (phase === "spinning" || busy) return;
    if (balance < def.price) {
      setNeedDeposit(true);
      return;
    }
    setNeedDeposit(false);
    setError(null);
    setBusy(true);

    let serverResult: { prize: Prize; bet_stars: number; balance_stars: number; prize_stars: number };
    try {
      serverResult = await api.openCase(telegramId, def.id);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Не удалось открыть кейс");
      return;
    }

    const won = serverResult.prize;
    const next = Array.from({ length: REEL_LEN }, (_, i) =>
      i === WIN_AT ? won : sorted[Math.floor(Math.random() * sorted.length)],
    );
    setPrize(null);
    setPhase("spinning");
    tg?.HapticFeedback?.impactOccurred("medium");
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
      setBusy(false);
      void onCredited();
      tg?.HapticFeedback?.notificationOccurred(won.value >= def.price ? "success" : "warning");
    }, SPIN_MS + 150);
  }

  const spinning = phase === "spinning";

  return (
    <Sheet title={def.title} onClose={onClose} locked={spinning} tall>
      {error && <p className="notice bad">{error}</p>}
      <div className="reel" ref={viewport}>
        <div
          className="reel-track"
          style={{
            transform: `translate3d(${-x}px,0,0)`,
            transition: animating ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.72, 0.12, 1)` : "none",
          }}
        >
          {reel.map((p, i) => (
            <div
              key={`${p.id}-${i}`}
              className={`slot ${i === WIN_AT ? "filled" : ""}`}
              style={{ transform: `translateY(${i * STEP}px)` }}
            >
              <PrizeArt prize={p} size={64} />
              <div className="slot-hint">{p.name}</div>
            </div>
          ))}
        </div>
        <div className="reel-pointer" />
      </div>

      {phase === "done" && prize && (
        <div className="case-done">
          <div className="case-prize">
            <PrizeArt prize={prize} size={80} />
            <div className="case-prize-name">{prize.name}</div>
            <div className="case-prize-value">{fmt(prize.value)} ◆</div>
            <div className="case-prize-msg">Предмет добавлен в инвентарь</div>
          </div>
          <button className="btn primary wide" onClick={onClose}>
            Забрать
          </button>
        </div>
      )}

      {phase === "idle" && (
        <div className="case-controls">
          {needDeposit && (
            <p className="notice bad">Недостаточно средств. Пополните баланс.</p>
          )}
          {!needDeposit && (
            <>
              <div className="case-bet">
                <small>Ставка</small>
                <b>{fmt(def.price)} ◆</b>
              </div>
              <button className="btn primary wide" onClick={open} disabled={busy}>
                {busy ? "Крутим…" : "Открыть кейс"}
              </button>
            </>
          )}
          <button className="link-btn" onClick={onDeposit}>
            Пополнить баланс
          </button>
        </div>
      )}
    </Sheet>
  );
}
