import { useState } from "react";
import { fmt } from "../lib/format";
import { Ton } from "../ui/Icons";

type Cell = "closed" | "safe" | "mine";
type GameProps = {
  balance: number;
  onSpend: (amount: number, label: string) => void;
  onWin: (amount: number, label: string) => void;
  onDeposit: () => void;
};

export default function MinesGame({ balance, onSpend, onWin, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [mineCount, setMineCount] = useState(3);
  const [cells, setCells] = useState<Cell[]>(Array(25).fill("closed"));
  const [mines, setMines] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<"ready" | "playing" | "lost" | "won">("ready");
  const opened = cells.filter((c) => c === "safe").length;
  const step = 0.12 + mineCount * 0.025;
  const mult = Number((1 + opened * step).toFixed(2));

  function start() {
    if (balance < bet) return onDeposit();
    onSpend(bet, "Мины");
    const order = Array.from({ length: 25 }, (_, i) => i).sort(() => Math.random() - 0.5);
    setMines(new Set(order.slice(0, mineCount)));
    setCells(Array(25).fill("closed"));
    setPhase("playing");
  }

  function openCell(i: number) {
    if (phase !== "playing" || cells[i] !== "closed") return;
    if (mines.has(i)) {
      setCells((cur) => cur.map((c, idx) => (mines.has(idx) ? "mine" : c)));
      setPhase("lost");
      return;
    }
    const next = [...cells];
    next[i] = "safe";
    setCells(next);
    if (opened + 1 === 25 - mineCount) {
      onWin(Number((bet * (1 + (opened + 1) * step)).toFixed(2)), "Выигрыш: Мины");
      setPhase("won");
    }
  }

  function collect() {
    if (!opened) return;
    onWin(Number((bet * mult).toFixed(2)), "Выигрыш: Мины");
    setPhase("won");
  }

  const locked = phase === "playing";

  return (
    <div className="stack">
      <div className="mines-top">
        <span>
          <small>Множитель</small>
          <b>×{mult.toFixed(2).replace(".", ",")}</b>
        </span>
        <span>
          <small>Сейчас в выигрыше</small>
          <b>
            <Ton size={15} />
            {fmt(bet * mult)}
          </b>
        </span>
      </div>
      <div className="mines-grid">
        {cells.map((c, i) => (
          <button key={i} className={`mine-cell ${c}`} onClick={() => openCell(i)} aria-label={`Клетка ${i + 1}`}>
            {c === "safe" && <Ton size={24} />}
            {c === "mine" && <span>💣</span>}
          </button>
        ))}
      </div>
      {phase === "lost" && <p className="notice bad">Мина. Ставка сгорела.</p>}
      {phase === "won" && <p className="notice good">Выигрыш зачислен на баланс.</p>}
      <div className="row2">
        <div className="stepper">
          <button onClick={() => setBet(Math.max(0.5, bet - 0.5))} disabled={locked} aria-label="Меньше ставка">
            −
          </button>
          <b>
            <Ton size={16} />
            {fmt(bet)}
          </b>
          <button onClick={() => setBet(bet + 0.5)} disabled={locked} aria-label="Больше ставка">
            +
          </button>
        </div>
        <div className="stepper">
          <button onClick={() => setMineCount(Math.max(1, mineCount - 1))} disabled={locked} aria-label="Меньше мин">
            −
          </button>
          <b>💣 {mineCount}</b>
          <button onClick={() => setMineCount(Math.min(10, mineCount + 1))} disabled={locked} aria-label="Больше мин">
            +
          </button>
        </div>
      </div>
      {locked && opened > 0 ? (
        <button className="btn gold wide" onClick={collect}>
          Забрать {fmt(bet * mult)}
        </button>
      ) : (
        <button className="btn primary wide" onClick={start} disabled={locked}>
          {locked ? "Открой клетку" : "Начать игру"}
        </button>
      )}
    </div>
  );
}
