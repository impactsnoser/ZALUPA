import { useState } from "react";
import { api, type ServerMinesGame } from "../api";
import { fmt } from "../lib/format";
import { Ton } from "../ui/Icons";

type Cell = "closed" | "safe" | "mine";
type GameProps = {
  balance: number;
  starsPerTon: number;
  telegramId: number;
  onBalance: (stars: number, ton: number) => void;
  onChanged: () => void;
  onDeposit: () => void;
};

export default function MinesGame({ balance, starsPerTon, telegramId, onBalance, onChanged, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [betInput, setBetInput] = useState("1");
  const [mineCount, setMineCount] = useState(3);
  const [game, setGame] = useState<ServerMinesGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const phase = game?.status === "active" ? "playing" : game?.status === "lost" ? "lost" : game?.status === "won" ? "won" : "ready";
  const opened = game?.opened.length ?? 0;
  const mult = game?.multiplier ?? 1;
  const cells: Cell[] = Array.from({ length: 25 }, (_, index) => {
    if (game?.opened.includes(index)) return "safe";
    if (game?.status === "lost" && game.mines?.includes(index)) return "mine";
    return "closed";
  });

  function updateBet(value: number) {
    const rounded = Number(value.toFixed(2));
    setBet(rounded);
    setBetInput(String(rounded));
  }

  async function start() {
    if (busy || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000) return;
    if (balance < bet) return onDeposit();
    setBusy(true);
    setError("");
    try {
      const result = await api.startMines(telegramId, Math.max(1, Math.round(bet * starsPerTon)), mineCount);
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать раунд");
    } finally {
      setBusy(false);
    }
  }

  async function openCell(index: number) {
    if (phase !== "playing" || busy || cells[index] !== "closed" || !game) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.openMine(telegramId, game.session_id, index);
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      if (result.status !== "active") onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть клетку");
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    if (!game || !opened || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.cashoutMines(telegramId, game.session_id);
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось забрать выигрыш");
    } finally {
      setBusy(false);
    }
  }

  const locked = phase === "playing";
  const payout = game ? (game.bet_ton * mult) : bet * mult;

  return (
    <div className="stack">
      <div className="mines-top">
        <span><small>Множитель</small><b>×{mult.toFixed(2).replace(".", ",")}</b></span>
        <span><small>Сейчас в выигрыше</small><b><Ton size={15} />{fmt(payout)}</b></span>
      </div>
      <div className="mines-grid">
        {cells.map((cell, index) => (
          <button key={index} className={`mine-cell ${cell}`} onClick={() => void openCell(index)} disabled={busy || !locked || cell !== "closed"} aria-label={`Клетка ${index + 1}`}>
            {cell === "safe" && <Ton size={24} />}
            {cell === "mine" && <span>💣</span>}
          </button>
        ))}
      </div>
      {phase === "lost" && <p className="notice bad">Мина. Ставка сгорела.</p>}
      {phase === "won" && <p className="notice good">Выигрыш {fmt(game?.payout_ton ?? 0)} зачислен на баланс.</p>}
      {error && <p className="notice bad">{error}</p>}
      <div className="row2">
        <div className="stepper bet-control">
          <button onClick={() => updateBet(Math.max(0.5, bet - 0.5))} disabled={locked || busy} aria-label="Меньше ставка">−</button>
          <label className="bet-value" aria-label="Ставка в TON">
            <Ton size={15} />
            <input type="text" inputMode="decimal" value={betInput} onChange={(event) => { const value = event.target.value.replace(",", "."); setBetInput(value); setBet(Number(value) || 0); }} disabled={locked || busy} />
          </label>
          <button onClick={() => updateBet(Math.min(100_000, bet + 0.5))} disabled={locked || busy} aria-label="Больше ставка">+</button>
        </div>
        <div className="stepper">
          <button onClick={() => setMineCount(Math.max(1, mineCount - 1))} disabled={locked || busy} aria-label="Меньше мин">−</button>
          <b>💣 {mineCount}</b>
          <button onClick={() => setMineCount(Math.min(10, mineCount + 1))} disabled={locked || busy} aria-label="Больше мин">+</button>
        </div>
      </div>
      {locked && opened > 0 ? (
        <button className="btn gold wide" onClick={() => void collect()} disabled={busy}>Забрать {fmt(payout)}</button>
      ) : (
        <button className="btn primary wide" onClick={() => void start()} disabled={busy || locked || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000}>
          {busy ? "Обработка…" : locked ? "Открой клетку" : "Начать игру"}
        </button>
      )}
    </div>
  );
}
