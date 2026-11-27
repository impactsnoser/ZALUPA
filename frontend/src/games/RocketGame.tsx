import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type RocketRound, type RocketRoundStatus } from "../api";
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

/** Кривая полёта в координатах сцены 360×260. */
const CURVE: Curve = [
  { x: 16, y: 222 },
  { x: 112, y: 218 },
  { x: 206, y: 162 },
  { x: 320, y: 58 },
];

const W = 360;
const H = 260;

/** Коэффициент роста — должен совпадать с ROCKET_GROWTH на бэкенде. */
const ROCKET_GROWTH = 0.044445;

/** Кривая множителя: 6·e^(growth·t) − 5 (та же формула, что на сервере). */
function multFromElapsed(elapsed: number): number {
  if (elapsed <= 0) return 1;
  return Math.max(1, 6 * Math.exp(ROCKET_GROWTH * elapsed) - 5);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

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

function progressOf(mult: number): number {
  const growth = Math.log(Math.max(1, mult)) / Math.log(6);
  return clamp(0.18 + 0.82 * growth, 0, 1);
}

/** Прорисовка части кривой от 0 до u. */
function strokeCurve(ctx: CanvasRenderingContext2D, u: number, style: string | CanvasGradient, width: number) {
  if (u <= 0.001) return;
  const steps = Math.max(2, Math.round(44 * u));
  const start = pointAt(0);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 1; i <= steps; i += 1) {
    const p = pointAt((u * i) / steps);
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawRocket(ctx: CanvasRenderingContext2D, time: number, crashed: boolean, pilot: HTMLImageElement) {
  ctx.save();
  ctx.scale(1.55, 1.55);
  if (crashed) ctx.globalAlpha = 0.35;

  // Длинный горячий след за ракетой.
  const flick = 0.86 + Math.sin(time * 22) * 0.14;
  const flame = ctx.createLinearGradient(-82, 0, -26, 0);
  flame.addColorStop(0, "rgba(255, 82, 33, 0)");
  flame.addColorStop(0.34, "rgba(255, 98, 35, 0.88)");
  flame.addColorStop(0.76, "#ffb52e");
  flame.addColorStop(1, "#fff3a8");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(-26, -9);
  ctx.quadraticCurveTo(-51, -16 * flick, -82, 0);
  ctx.quadraticCurveTo(-51, 16 * flick, -26, 9);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 251, 222, 0.9)";
  ctx.beginPath();
  ctx.moveTo(-26, -4);
  ctx.quadraticCurveTo(-46, -7 * flick, -62, 0);
  ctx.quadraticCurveTo(-46, 7 * flick, -26, 4);
  ctx.closePath();
  ctx.fill();

  // Плавники за кабиной.
  const fin = ctx.createLinearGradient(0, -27, 0, 12);
  fin.addColorStop(0, "#93e2ff");
  fin.addColorStop(0.42, "#3789ff");
  fin.addColorStop(1, "#2541bd");
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-20, -8);
  ctx.quadraticCurveTo(-39, -27, -53, -24);
  ctx.quadraticCurveTo(-46, -12, -34, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-20, 8);
  ctx.quadraticCurveTo(-39, 27, -53, 24);
  ctx.quadraticCurveTo(-44, 10, -34, -1);
  ctx.closePath();
  ctx.fill();

  // Голубой иллюминатор и мишка-пилот.
  ctx.save();
  ctx.shadowColor = "rgba(76, 210, 255, 0.8)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(52, 151, 255, 0.48)";
  ctx.beginPath();
  ctx.ellipse(-4, -22, 22, 21, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (pilot.complete && pilot.naturalWidth > 0) {
    ctx.drawImage(pilot, -28, -51, 48, 48);
  }
  ctx.strokeStyle = "rgba(190, 245, 255, 0.96)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-4, -22, 22, 21, -0.12, Math.PI * 1.04, Math.PI * 1.92);
  ctx.stroke();

  // Широкий корпус с острым носом, как у ракеты из референса.
  const body = ctx.createLinearGradient(0, -20, 0, 18);
  body.addColorStop(0, "#d7f7ff");
  body.addColorStop(0.2, "#63caff");
  body.addColorStop(0.57, "#2589ff");
  body.addColorStop(1, "#2450d2");
  ctx.fillStyle = body;
  ctx.strokeStyle = "#173caa";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-34, -8);
  ctx.quadraticCurveTo(-23, -19, -3, -18);
  ctx.quadraticCurveTo(20, -17, 34, -7);
  ctx.quadraticCurveTo(43, -1, 42, 1);
  ctx.quadraticCurveTo(37, 12, 15, 17);
  ctx.quadraticCurveTo(-13, 21, -31, 9);
  ctx.quadraticCurveTo(-38, 2, -34, -8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Острие, металлический обод и блики корпуса.
  const nose = ctx.createLinearGradient(21, -9, 43, 6);
  nose.addColorStop(0, "#e8fbff");
  nose.addColorStop(0.45, "#72dcff");
  nose.addColorStop(1, "#2584f5");
  ctx.fillStyle = nose;
  ctx.beginPath();
  ctx.moveTo(22, -12);
  ctx.quadraticCurveTo(36, -8, 43, 0);
  ctx.quadraticCurveTo(36, 10, 18, 13);
  ctx.quadraticCurveTo(26, 2, 22, -12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.8)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-25, -10);
  ctx.quadraticCurveTo(-9, -18, 8, -13);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-28, 0, 4, 11, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#203fa8";
  ctx.fill();

  // Кабина проходит поверх корпуса, удерживая пилота внутри ракеты.
  ctx.strokeStyle = "rgba(208, 249, 255, 0.88)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(-4, -22, 22, 21, -0.12, Math.PI * 1.04, Math.PI * 1.92);
  ctx.stroke();
  ctx.restore();
}
function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, phase: number) {
  const bob = Math.sin(time * 1.8 + phase) * 5;
  const tilt = Math.sin(time * 1.2 + phase) * 0.16;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);

  const gold = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8);
  gold.addColorStop(0, "#fff1b8");
  gold.addColorStop(0.5, "#ffd75e");
  gold.addColorStop(1, "#d99a1f");
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(185, 121, 26, 0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 5.4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 246, 216, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(1.6, 0);
  ctx.lineTo(0, 3);
  ctx.lineTo(-1.6, 0);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

type NumberRef = { current: number };
type NullableNumberRef = { current: number | null };
type BoolRef = { current: boolean };
type TextRef = { current: HTMLSpanElement | null };
type StringRef = { current: string };
type ClockRef = { current: { elapsed: number; receivedAtMs: number } | null };

/**
 * Вся движущаяся графика рисуется на canvas.
 * Множитель: серверное elapsed + клиентское время с момента ответа.
 * Статусы waiting/countdown держат ракету на старте, finished — на точке краша.
 */
function RocketScene({
  statusRef,
  clockRef,
  frozenRef,
  crashedRef,
  multRef,
  cashRef,
  betRef,
  resetRef,
  shownRef,
}: {
  statusRef: StringRef;
  clockRef: ClockRef;
  frozenRef: NullableNumberRef;
  crashedRef: BoolRef;
  multRef: TextRef;
  cashRef: TextRef;
  betRef: NumberRef;
  resetRef: NumberRef;
  shownRef: NumberRef;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    const pilot = new Image();
    pilot.src = "/prizes/rocket-bear.png";
    let dpr = 1;
    let cssW = W;
    let cssH = H;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    };
    resize();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
    } else {
      window.addEventListener("resize", resize);
    }

    let shown = 1;
    let lastReset = resetRef.current;

    const render = () => {
      const time = performance.now() / 1000;

      if (resetRef.current !== lastReset) {
        lastReset = resetRef.current;
        shown = 1;
      }

      const status = statusRef.current;
      const frozen = frozenRef.current;
      let target: number;
      if (status === "finished" && frozen !== null) {
        target = frozen;
      } else if (status === "flying") {
        const clock = clockRef.current;
        const elapsed = clock ? clock.elapsed + (Date.now() - clock.receivedAtMs) / 1000 : 0;
        target = multFromElapsed(elapsed);
      } else {
        target = 1;
      }

      shown += (target - shown) * 0.4;
      shownRef.current = shown;

      if (multRef.current) {
        const text = `X${shown.toFixed(2).replace(".", ",")}`;
        if (multRef.current.textContent !== text) multRef.current.textContent = text;
      }
      if (cashRef.current) {
        const text = fmt(betRef.current * shown);
        if (cashRef.current.textContent !== text) cashRef.current.textContent = text;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.setTransform((cssW / W) * dpr, 0, 0, (cssH / H) * dpr, 0, 0);

      const u = progressOf(shown);

      strokeCurve(ctx, 1, "rgba(255, 255, 255, 0.06)", 2);
      strokeCurve(ctx, u, "rgba(255, 47, 126, 0.2)", 11);
      const trail = ctx.createLinearGradient(0, H, W, 0);
      trail.addColorStop(0, "#a01a52");
      trail.addColorStop(0.45, "#ff2f7e");
      trail.addColorStop(1, "#ff7aa8");
      strokeCurve(ctx, u, trail, 4.6);
      strokeCurve(ctx, u, "rgba(255, 214, 232, 0.55)", 1.2);

      drawCoin(ctx, 268, 88, time, 0);
      drawCoin(ctx, 314, 150, time, 1.7);
      drawCoin(ctx, 224, 110, time, 3.1);

      const rx = 118 + (258 - 118) * u;
      const ry = 176 + (96 - 176) * u + Math.sin(time * 3) * 2.5;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(-0.42 - 0.1 * u);
      drawRocket(ctx, time, crashedRef.current, pilot);
      ctx.restore();
    };

    render();
    const frame = () => {
      render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [statusRef, clockRef, frozenRef, crashedRef, multRef, cashRef, betRef, resetRef, shownRef]);

  return <canvas ref={canvasRef} className="rk-canvas" aria-hidden="true" />;
}

const STATUS_LABEL: Record<RocketRoundStatus, string> = {
  waiting: "Приём ставок",
  countdown: "Старт",
  flying: "В полёте",
  finished: "Раунд завершён",
};

function initialOf(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

export default function RocketGame({ balance, starsPerTon, telegramId, onBalance, onChanged, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [betInput, setBetInput] = useState("1");
  const [round, setRound] = useState<RocketRound | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<number[]>([]);

  const polling = useRef(false);
  const multRef = useRef<HTMLSpanElement>(null);
  const cashRef = useRef<HTMLSpanElement>(null);
  const betRef = useRef(1);
  const statusRef = useRef<string>("waiting");
  const clockRef = useRef<{ elapsed: number; receivedAtMs: number } | null>(null);
  const frozenRef = useRef<number | null>(null);
  const crashedRef = useRef(false);
  const resetRef = useRef(0);
  const shownRef = useRef(1);
  const roundIdRef = useRef(0);
  const lastBalanceRef = useRef<number | null>(null);
  const prevStatusRef = useRef<string>("");

  const status = round?.status ?? "waiting";
  const myBet = round?.my_bet ?? null;
  const perTon = starsPerTon > 0 ? starsPerTon : 1;
  const canPlaceBet = (status === "waiting" || status === "countdown") && !myBet;
  const myBetTon = myBet ? myBet.bet_stars / perTon : 0;
  betRef.current = myBetTon;

  // История завершённых раундов.
  function loadHistory() {
    void api
      .rocketHistory()
      .then((res) => setHistory(res.items ?? []))
      .catch(() => undefined);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  // Опрос общего раунда. Анимация локальная, поэтому даже 300 мс не дают рывков.
  useEffect(() => {
    let stopped = false;

    const tick = () => {
      if (polling.current || stopped) return;
      polling.current = true;
      void api
        .rocketRound(telegramId)
        .then((result) => {
          if (stopped) return;

          // Новый раунд — сбрасываем анимацию с единицы.
          if (result.round_id !== roundIdRef.current) {
            roundIdRef.current = result.round_id;
            resetRef.current += 1;
            frozenRef.current = null;
          }

          statusRef.current = result.status;
          crashedRef.current = result.status === "finished";

          if (result.status === "flying") {
            if (typeof result.elapsed === "number") {
              clockRef.current = { elapsed: result.elapsed, receivedAtMs: Date.now() };
            }
            frozenRef.current = null;
          } else if (result.status === "finished") {
            frozenRef.current = result.crash_multiplier ?? result.multiplier;
            clockRef.current = null;
          } else {
            clockRef.current = null;
            frozenRef.current = null;
          }

          // Баланс меняется только после ставки/выкупа — не дёргаем родителя зря.
          if (lastBalanceRef.current !== result.balance_stars) {
            lastBalanceRef.current = result.balance_stars;
            onBalance(result.balance_stars, result.balance_ton);
          }

          // Раунд завершился — обновляем историю множителей.
          if (result.status !== prevStatusRef.current) {
            if (result.status === "finished") loadHistory();
            prevStatusRef.current = result.status;
          }

          setRound(result);
        })
        .catch(() => undefined)
        .finally(() => {
          polling.current = false;
        });
    };

    tick();
    const timer = window.setInterval(tick, 300);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [telegramId, onBalance]);

  async function placeBet() {
    if (busy || !Number.isFinite(bet) || bet < 0.01) return;
    if (balance < bet) return onDeposit();
    setBusy(true);
    setError("");
    try {
      const result = await api.rocketBet(telegramId, Math.max(1, Math.round(bet * starsPerTon)));
      lastBalanceRef.current = result.balance_stars;
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сделать ставку");
    } finally {
      setBusy(false);
    }
  }

  async function cashout() {
    if (busy || !round || myBet?.status !== "active") return;
    setBusy(true);
    setError("");
    // Замораживаем число на клике: во время запроса оно не должно расти.
    frozenRef.current = shownRef.current;
    try {
      const result = await api.rocketCashout(telegramId, round.round_id);
      if (result.my_bet?.status === "won" && result.my_bet.payout_stars > 0) {
        lastBalanceRef.current = result.balance_stars;
        onBalance(result.balance_stars, result.balance_ton);
        onChanged();
      }
      setRound((prev) => (prev ? { ...prev, ...result } : result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось забрать выигрыш");
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

  const countdown = round?.countdown_seconds ?? 0;
  const waitingLeft = round?.waiting_seconds ?? 0;
  const crashMult = round?.crash_multiplier ?? null;
  const cashedOut = myBet?.status === "won";
  const lost = myBet?.status === "lost";
  const cashoutMult = myBet?.cashout_milli ? myBet.cashout_milli / 1000 : null;

  return (
    <div className="stack">
      <div className={`rk-stage ${status}`}>
        <div className="rk-grid" aria-hidden="true" />
        <div className="rk-stars" aria-hidden="true" />

        <div className="rk-top">
          <span className="rk-top-item">
            ВСЕГО <Ton size={12} /> <b>{fmt(balance)}</b>
          </span>
          <span className="rk-top-item rk-status">{STATUS_LABEL[status]}</span>
        </div>

        <b className="rk-mult">
          <span ref={multRef} />
        </b>

        <RocketScene
          statusRef={statusRef}
          clockRef={clockRef}
          frozenRef={frozenRef}
          crashedRef={crashedRef}
          multRef={multRef}
          cashRef={cashRef}
          betRef={betRef}
          resetRef={resetRef}
          shownRef={shownRef}
        />

        {status === "waiting" && (
          <div className="rk-overlay-count">
            <span>Раунд начнётся через</span>
            <b>{Math.max(0, Math.ceil(waitingLeft))}</b>
          </div>
        )}
        {status === "countdown" && (
          <div className="rk-overlay-count go">
            <span>Поехали!</span>
            <b>{countdown || 3}</b>
          </div>
        )}

        {status === "finished" && (
          <p className="rk-msg bad">Улетела на {crashMult !== null ? fmt(crashMult) : "?"}×</p>
        )}
        {cashedOut && !lost && (
          <p className={`rk-msg good${status === "finished" ? " stacked" : ""}`}>
            Забрал {fmt(myBet?.payout_stars ? myBet.payout_stars / perTon : 0)} TON · ×{cashoutMult ? fmt(cashoutMult) : "—"}
          </p>
        )}
      </div>

      {/* Ставки игроков в текущем раунде */}
      <div className="rk-live">
        <div className="rk-live-head">
          <span>Ставки в раунде</span>
          <small>
            {round?.bets.length ?? 0} {round?.bets.length === 1 ? "игрок" : "игроков"}
          </small>
        </div>
        <div className="rk-live-row">
          {(round?.bets.length ?? 0) === 0 && <span className="rk-live-empty">Пока никто не поставил — будь первым</span>}
          {round?.bets.map((b) => (
            <span key={b.user_id} className={`rk-live-chip ${b.status}`}>
              <i>{initialOf(b.name)}</i>
              <span>{b.name}</span>
              <b>{fmt(b.bet_stars / perTon)}</b>
            </span>
          ))}
        </div>
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

      {/* Управление ставкой */}
      {canPlaceBet && (
        <>
          <div className="rocket-bet-field">
            <span className="rocket-bet-caption">ТВОЯ СТАВКА · TON</span>
            <div className="stepper bet-control rocket-bet-stepper">
              <button onClick={() => updateBet(bet - 0.5)} disabled={busy} aria-label="Меньше ставка">
                −
              </button>
              <label className="bet-value" aria-label="Ставка в TON">
                <Ton size={16} />
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Введите сумму ставки в TON"
                  value={betInput}
                  onChange={(event) => editBet(event.target.value)}
                />
              </label>
              <button onClick={() => updateBet(bet + 0.5)} disabled={busy} aria-label="Больше ставка">
                +
              </button>
            </div>
            <span className="rocket-bet-hint">Ставка принимается до старта раунда</span>
          </div>
          <button className="btn primary wide" onClick={() => void placeBet()} disabled={busy || !Number.isFinite(bet) || bet < 0.01}>
            {busy ? "Ставим…" : "Сделать ставку"}
          </button>
        </>
      )}

      {myBet?.status === "active" && status === "flying" && (
        <button className="btn gold wide" onClick={() => void cashout()} disabled={busy}>
          {busy ? "Забираем…" : <>Забрать <b ref={cashRef} /> TON</>}
        </button>
      )}

      {myBet?.status === "active" && (status === "waiting" || status === "countdown") && (
        <div className="rk-wait-note">
          Ставка {fmt(myBetTon)} TON принята · ждём старт
        </div>
      )}

      {!myBet && !canPlaceBet && (
        <div className="rk-wait-note">
          {status === "finished"
            ? "Раунд завершён — следующий стартует через пару секунд"
            : "Раунд уже идёт. Следующая ставка — через пару секунд."}
        </div>
      )}

      {cashedOut && (
        <div className="rk-wait-note good">Выигрыш {fmt(myBet?.payout_stars ? myBet.payout_stars / perTon : 0)} TON зачислен</div>
      )}
      {lost && <div className="rk-wait-note bad">В этом раунде не успел забрать</div>}
    </div>
  );
}

function tierOf(value: number): number {
  if (value >= 10) return 4;
  if (value >= 3) return 3;
  if (value >= 1.5) return 2;
  return 1;
}
