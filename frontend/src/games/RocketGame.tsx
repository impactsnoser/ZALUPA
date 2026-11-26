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

type Pt = { x: number; y: number };
type Curve = [Pt, Pt, Pt, Pt];

/** Кривая полёта в координатах viewBox 360×260. */
const CURVE: Curve = [
  { x: 16, y: 218 },
  { x: 108, y: 214 },
  { x: 200, y: 158 },
  { x: 316, y: 52 },
];

function pointAt(t: number, c: Curve = CURVE): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

function angleAt(t: number, c: Curve = CURVE): number {
  const e = 0.001;
  const a = pointAt(Math.max(0, t - e), c);
  const b = pointAt(Math.min(1, t + e), c);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function trailPath(u: number): string {
  const steps = 34;
  let path = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (u * i) / steps;
    const p = pointAt(t);
    path += `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
  }
  return path.trim();
}

function fullPath(): string {
  return trailPath(1);
}

/** Мультяшная ракета. Рисуется в системе 64×64, нос смотрит вправо. */
function RocketArt({ crashed }: { crashed?: boolean }) {
  return (
    <g className={`rk-craft${crashed ? " crashed" : ""}`}>
      <g className="rk-flame">
        <path d="M22 32 C12 25 3 16 0 32 C3 48 12 39 22 32 Z" fill="#ff7a2f" />
        <path d="M22 32 C15 28 9 23 6 32 C9 41 15 36 22 32 Z" fill="#ffe27a" />
      </g>
      <path d="M31 21 L24 8 L42 19 Z" fill="#2447b8" />
      <path d="M31 43 L24 56 L42 45 Z" fill="#2447b8" />
      <path
        d="M20 32 C20 23 32 16 44 17 C54 18 60 25 62 32 C60 39 54 46 44 47 C32 48 20 41 20 32 Z"
        fill="url(#rkBody)"
      />
      <path
        d="M27 24 C35 19 46 20 52 25"
        stroke="#dbe9ff"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".55"
        fill="none"
      />
      <path d="M46 18 C55 20 60 26 62 32 C59 31 53 28 47 27 Z" fill="#9dc2ff" opacity=".7" />
      <circle cx="44" cy="32" r="9.5" fill="#241a4d" stroke="#8f6bff" strokeWidth="2" />
      <circle cx="44" cy="32" r="6" fill="url(#rkGlass)" />
      <circle cx="41.5" cy="29.5" r="1.8" fill="#fff" opacity=".85" />
    </g>
  );
}

function Coin({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="rk-coin" style={{ animationDelay: `${delay}s` }}>
        <circle r="7.5" fill="url(#rkCoin)" />
        <circle r="5.4" fill="none" stroke="#b9791a" strokeWidth="1" opacity=".8" />
        <path d="M0 -3 L1.6 0 L0 3 L-1.6 0 Z" fill="#fff6d8" opacity=".9" />
      </g>
    </g>
  );
}

export default function RocketGame({ balance, starsPerTon, telegramId, onBalance, onChanged, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [betInput, setBetInput] = useState("1");
  const [game, setGame] = useState<ServerRocketGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<number[]>([]);
  const [displayMult, setDisplayMult] = useState(1);
  const polling = useRef(false);
  const displayRef = useRef(1);
  const prevStatus = useRef("");

  const phase =
    game?.status === "active" ? "running" : game?.status === "lost" ? "crashed" : game?.status === "won" ? "cashed" : "ready";
  const mult = game?.multiplier ?? 1;
  const payout = game?.payout_ton ?? bet * mult;
  const targetMult = Math.max(1, mult);

  // Плавно догоняем серверный множитель между опросами.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cur = displayRef.current;
      const diff = targetMult - cur;
      const next = Math.abs(diff) < 0.004 ? targetMult : cur + diff * 0.16;
      displayRef.current = next;
      setDisplayMult(next);
      if (next !== targetMult) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetMult]);

  // История последних раундов: настоящая, с бэкенда.
  function loadHistory() {
    void api
      .rocketHistory()
      .then((res) => setHistory(res.items ?? []))
      .catch(() => undefined);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    const status = game?.status ?? "";
    if (prevStatus.current === "active" && (status === "lost" || status === "won" || status === "abandoned")) {
      loadHistory();
    }
    prevStatus.current = status;
  }, [game?.status]);

  useEffect(() => {
    if (phase !== "running" || !game) return;
    const sessionId = game.session_id;
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void api
        .checkRocket(telegramId, sessionId)
        .then((result) => {
          setGame(result);
          onBalance(result.balance_stars, result.balance_ton);
          if (result.status !== "active") onChanged();
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Не удалось обновить раунд"))
        .finally(() => {
          polling.current = false;
        });
    }, 300);
    return () => window.clearInterval(timer);
  }, [game?.session_id, phase, telegramId, onBalance, onChanged]);

  async function launch() {
    if (busy || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000) return;
    if (balance < bet) return onDeposit();
    displayRef.current = 1;
    setDisplayMult(1);
    prevStatus.current = "";
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

  const showMult = Math.max(1, displayMult);
  const u = Math.min(1, Math.max(0, 0.06 + ((showMult - 1) / 3) * 0.94));
  const tip = pointAt(u);
  const angle = angleAt(u);
  const crashMult = game?.crash_multiplier ?? game?.multiplier ?? mult;

  return (
    <div className="stack">
      <div className={`rk-stage ${phase}`}>
        <div className="rk-grid" aria-hidden="true" />
        <div className="rk-stars" aria-hidden="true" />

        <div className="rk-top">
          <span className="rk-top-item">
            СТАВКА <Ton size={12} /> <b>{fmt(bet)}</b>
          </span>
          <span className="rk-top-item">
            ВСЕГО <Ton size={12} /> <b>{fmt(balance)}</b>
          </span>
        </div>

        <b className="rk-mult">
          <span className="rk-x">×</span>
          {showMult.toFixed(2).replace(".", ",")}
        </b>

        <svg className="rk-chart" viewBox="0 0 360 260" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <linearGradient id="rkBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5d8cff" />
              <stop offset=".55" stopColor="#3f6bff" />
              <stop offset="1" stopColor="#2447b8" />
            </linearGradient>
            <radialGradient id="rkGlass" cx=".35" cy=".3" r=".8">
              <stop offset="0" stopColor="#c8f7ff" />
              <stop offset=".55" stopColor="#6fd0f5" />
              <stop offset="1" stopColor="#2a6fd0" />
            </radialGradient>
            <linearGradient id="rkCoin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe27a" />
              <stop offset="1" stopColor="#e0a02a" />
            </linearGradient>
            <linearGradient id="rkTrail" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#a01a52" />
              <stop offset=".45" stopColor="#ff2f7e" />
              <stop offset="1" stopColor="#ff6aa8" />
            </linearGradient>
          </defs>

          {/* призрачная траектория впереди */}
          <path d={fullPath()} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="2" strokeLinecap="round" />

          {/* пройденный путь */}
          <path d={trailPath(u)} fill="none" stroke="url(#rkTrail)" strokeWidth="7" strokeLinecap="round" opacity=".28" style={{ filter: "blur(4px)" }} />
          <path d={trailPath(u)} fill="none" stroke="url(#rkTrail)" strokeWidth="3.2" strokeLinecap="round" />
          <path d={trailPath(u)} fill="none" stroke="#ffd0e4" strokeWidth="1" strokeLinecap="round" opacity=".7" />

          <Coin x={244} y={96} delay={0} />
          <Coin x={292} y={150} delay={0.5} />
          <Coin x={205} y={120} delay={1.1} />

          <g transform={`translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
            <g transform="translate(-32 -32)">
              <RocketArt crashed={phase === "crashed"} />
            </g>
          </g>
        </svg>

        {phase === "crashed" && <p className="rk-msg bad">Улетела на {fmt(crashMult)}×</p>}
        {phase === "cashed" && <p className="rk-msg good">Забрал {fmt(payout)} TON</p>}
      </div>

      {history.length > 0 && (
        <div className="rk-history" aria-label="История множителей">
          {history.map((value, i) => (
            <span key={`${value}-${i}`} className="rk-chip" data-tier={tierOf(value)}>
              ×{value.toFixed(2).replace(".", ",")}
            </span>
          ))}
        </div>
      )}

      {error && <p className="notice bad">{error}</p>}

      <div className="rocket-bet-field">
        <span className="rocket-bet-caption">ТВОЯ СТАВКА · TON</span>
        <div className="stepper bet-control rocket-bet-stepper">
          <button onClick={() => updateBet(bet - 0.5)} disabled={phase === "running" || busy} aria-label="Меньше ставка">
            −
          </button>
          <label className="bet-value" aria-label="Ставка в TON">
            <Ton size={16} />
            {phase === "running" ? (
              <b>{fmt(bet)}</b>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                aria-label="Введите сумму ставки в TON"
                value={betInput}
                onChange={(event) => editBet(event.target.value)}
              />
            )}
          </label>
          <button onClick={() => updateBet(bet + 0.5)} disabled={phase === "running" || busy} aria-label="Больше ставка">
            +
          </button>
        </div>
        <span className="rocket-bet-hint">Нажми на сумму, чтобы изменить</span>
      </div>

      {phase === "running" ? (
        <button className="btn gold wide" onClick={() => void cash()} disabled={busy}>
          {busy ? "Забираем…" : `Забрать ${fmt(bet * mult)}`}
        </button>
      ) : (
        <button
          className="btn primary wide"
          onClick={() => void launch()}
          disabled={busy || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000}
        >
          {busy ? "Обработка…" : phase === "ready" ? "Сделать ставку" : "Сыграть ещё"}
        </button>
      )}
    </div>
  );
}

function tierOf(value: number): number {
  if (value >= 10) return 4;
  if (value >= 3) return 3;
  if (value >= 1.5) return 2;
  return 1;
}
