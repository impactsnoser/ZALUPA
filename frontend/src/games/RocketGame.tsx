import { useEffect, useState } from "react";
import { fmt } from "../lib/format";
import { Ton } from "../ui/Icons";

type GameProps = {
  balance: number;
  onSpend: (amount: number, label: string) => void;
  onWin: (amount: number, label: string) => void;
  onDeposit: () => void;
};

export default function RocketGame({ balance, onSpend, onWin, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [mult, setMult] = useState(1);
  const [crashAt, setCrashAt] = useState(2);
  const [phase, setPhase] = useState<"ready" | "running" | "crashed" | "cashed">("ready");

  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      setMult((cur) => {
        const next = Number((cur + 0.04 + cur * 0.008).toFixed(2));
        if (next >= crashAt) {
          window.clearInterval(timer);
          setPhase("crashed");
          return crashAt;
        }
        return next;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [phase, crashAt]);

  function launch() {
    if (balance < bet) return onDeposit();
    onSpend(bet, "Ракетка");
    setMult(1);
    setCrashAt(Number((1.2 + Math.random() * 2.6).toFixed(2)));
    setPhase("running");
  }

  function cash() {
    onWin(Number((bet * mult).toFixed(2)), "Выигрыш: Ракетка");
    setPhase("cashed");
  }

  const p = Math.min(1, (mult - 1) / 3);

  return (
    <div className="stack">
      <div className={`flight ${phase}`} style={{ ["--p" as string]: p }}>
        <b className="flight-mult">{mult.toFixed(2).replace(".", ",")}×</b>
        <span className="flight-ship" aria-hidden="true">
          🚀
        </span>
        {phase === "crashed" && <p className="flight-msg bad">Улетела на {fmt(crashAt)}×</p>}
        {phase === "cashed" && <p className="flight-msg good">Забрал {fmt(bet * mult)}</p>}
      </div>
      <div className="stepper">
        <button onClick={() => setBet(Math.max(0.5, bet - 0.5))} disabled={phase === "running"} aria-label="Меньше">
          −
        </button>
        <b>
          <Ton size={16} />
          {fmt(bet)}
        </b>
        <button onClick={() => setBet(bet + 0.5)} disabled={phase === "running"} aria-label="Больше">
          +
        </button>
      </div>
      {phase === "running" ? (
        <button className="btn gold wide" onClick={cash}>
          Забрать {fmt(bet * mult)}
        </button>
      ) : (
        <button className="btn primary wide" onClick={launch}>
          {phase === "ready" ? "Сделать ставку" : "Сыграть ещё"}
        </button>
      )}
    </div>
  );
}
