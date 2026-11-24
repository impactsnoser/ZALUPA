import { useEffect, useRef, useState } from "react";
import { api, type ServerRocketGame } from "../api";
import { fmt } from "../lib/format";
import { Ton } from "../ui/Icons";

type GameProps = {
  balance: number;
  starsPerTon: number;
  telegramId: number;
  onBalance: (stars: number, ton: number) => void;
  onChanged: () => void;
  onDeposit: () => void;
};

export default function RocketGame({ balance, starsPerTon, telegramId, onBalance, onChanged, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [betInput, setBetInput] = useState("1");
  const [game, setGame] = useState<ServerRocketGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const polling = useRef(false);

  const phase = game?.status === "active" ? "running" : game?.status === "lost" ? "crashed" : game?.status === "won" ? "cashed" : "ready";
  const mult = game?.multiplier ?? 1;
  const payout = game?.payout_ton ?? (bet * mult);

  useEffect(() => {
    if (phase !== "running" || !game) return;
    const sessionId = game.session_id;
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void api.checkRocket(telegramId, sessionId)
        .then((result) => {
          setGame(result);
          onBalance(result.balance_stars, result.balance_ton);
          if (result.status !== "active") onChanged();
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Не удалось обновить раунд"))
        .finally(() => { polling.current = false; });
    }, 300);
    return () => window.clearInterval(timer);
  }, [game?.session_id, phase, telegramId, onBalance, onChanged]);

  async function launch() {
    if (busy || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000) return;
    if (balance < bet) return onDeposit();
    setBusy(true);
    setError("");
    try {
      const result = await api.startRocket(telegramId, Math.max(1, Math.round(bet * starsPerTon)));
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать раунд");
    } finally {
      setBusy(false);
    }
  }

  function updateBet(next: number) {
    const rounded = Number(Math.min(100_000, Math.max(0.01, next)).toFixed(2));
    setBet(rounded);
    setBetInput(String(rounded));
  }

  function editBet(value: string) {
    const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
    setBetInput(normalized);
    setBet(Number(normalized) || 0);
  }

  async function cash() {
    if (!game || busy || phase !== "running") return;
    setBusy(true);
    setError("");
    try {
      const result = await api.cashoutRocket(telegramId, game.session_id);
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось забрать выигрыш");
    } finally {
      setBusy(false);
    }
  }

  const p = Math.min(1, (mult - 1) / 3);

  return (
    <div className="stack">
      <div className={`flight ${phase}`} style={{ ["--p" as string]: p }}>
        <b className="flight-mult">{mult.toFixed(2).replace(".", ",")}×</b>
        <span className="flight-ship" aria-hidden="true">🚀</span>
        {phase === "crashed" && <p className="flight-msg bad">Улетела на {fmt(game?.crash_multiplier ?? mult)}×</p>}
        {phase === "cashed" && <p className="flight-msg good">Забрал {fmt(payout)}</p>}
      </div>
      {error && <p className="notice bad">{error}</p>}
      <div className="rocket-bet-field">
        <span className="rocket-bet-caption">ТВОЯ СТАВКА · TON</span>
        <div className="stepper bet-control rocket-bet-stepper">
          <button onClick={() => updateBet(bet - 0.5)} disabled={phase === "running" || busy} aria-label="Меньше ставка">−</button>
          <label className="bet-value" aria-label="Ставка в TON">
            <Ton size={16} />
            {phase === "running" ? <b>{fmt(bet)}</b> : <input type="text" inputMode="decimal" aria-label="Введите сумму ставки в TON" value={betInput} onChange={(event) => editBet(event.target.value)} />}
          </label>
          <button onClick={() => updateBet(bet + 0.5)} disabled={phase === "running" || busy} aria-label="Больше ставка">+</button>
        </div>
        <span className="rocket-bet-hint">Нажми на сумму, чтобы изменить</span>
      </div>
      {phase === "running" ? (
        <button className="btn gold wide" onClick={() => void cash()} disabled={busy}>{busy ? "Забираем…" : `Забрать ${fmt(bet * mult)}`}</button>
      ) : (
        <button className="btn primary wide" onClick={() => void launch()} disabled={busy || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000}>
          {busy ? "Обработка…" : phase === "ready" ? "Сделать ставку" : "Сыграть ещё"}
        </button>
      )}
    </div>
  );
}
