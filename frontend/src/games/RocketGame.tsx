import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
const ROCKET_GROWTH = 0.08889;

/** Кривая множителя: 6·e^(growth·t) − 5. Считаем локально по клиентным часам. */
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

function drawRocket(ctx: CanvasRenderingContext2D, time: number, crashed: boolean) {
  ctx.save();
  ctx.scale(1.55, 1.55);
  if (crashed) ctx.globalAlpha = 0.35;

  // пламя
  const flick = 0.86 + Math.sin(time * 22) * 0.14;
  const flame = ctx.createLinearGradient(-74, 0, -22, 0);
  flame.addColorStop(0, "rgba(255, 90, 40, 0)");
  flame.addColorStop(0.3, "rgba(255, 106, 31, 0.85)");
  flame.addColorStop(0.72, "#ffb02e");
  flame.addColorStop(1, "#ffef9a");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(-20, -11);
  ctx.quadraticCurveTo(-46, -17 * flick, -74, 0);
  ctx.quadraticCurveTo(-46, 17 * flick, -20, 11);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 250, 214, 0.85)";
  ctx.beginPath();
  ctx.moveTo(-20, -4.5);
  ctx.quadraticCurveTo(-38, -7 * flick, -56, 0);
  ctx.quadraticCurveTo(-38, 7 * flick, -20, 4.5);
  ctx.closePath();
  ctx.fill();

  // хвостовые плавники
  const fin = ctx.createLinearGradient(0, -26, 0, 0);
  fin.addColorStop(0, "#5d8cff");
  fin.addColorStop(1, "#16267f");
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-2, -14);
  ctx.quadraticCurveTo(-16, -26, -30, -25);
  ctx.quadraticCurveTo(-19, -18, -15, -11);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 14);
  ctx.quadraticCurveTo(-16, 26, -30, 25);
  ctx.quadraticCurveTo(-19, 18, -15, 11);
  ctx.closePath();
  ctx.fill();

  // корпус
  const body = ctx.createLinearGradient(0, -22, 0, 22);
  body.addColorStop(0, "#8fb4ff");
  body.addColorStop(0.4, "#4a76ff");
  body.addColorStop(1, "#1a2f9e");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(-6, 0, 21.5, 19.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // фиолетовый нос
  const nose = ctx.createLinearGradient(0, -18, 0, 18);
  nose.addColorStop(0, "#d79bff");
  nose.addColorStop(0.42, "#9a52fa");
  nose.addColorStop(1, "#5b1cb4");
  ctx.fillStyle = nose;
  ctx.beginPath();
  ctx.moveTo(8, -16.5);
  ctx.bezierCurveTo(21, -14.5, 30, -9, 34, -2);
  ctx.quadraticCurveTo(36, 0, 34, 2);
  ctx.bezierCurveTo(30, 9, 21, 14.5, 8, 16.5);
  ctx.closePath();
  ctx.fill();

  // белое кольцо
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(8, 0, 4.4, 15.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // блик сверху корпуса
  ctx.strokeStyle = "rgba(232, 242, 255, 0.5)";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-18, -13);
  ctx.quadraticCurveTo(-6, -18, 4, -14.5);
  ctx.stroke();

  // юбка сопла
  ctx.fillStyle = "#2a3f9e";
  ctx.beginPath();
  ctx.ellipse(-27, 0, 4, 12.5, 0, 0, Math.PI * 2);
  ctx.fill();

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
type ServerClockRef = { current: { elapsed: number; receivedAtMs: number } | null };

/**
 * Вся движущаяся графика рисуется на canvas.
 * Множитель считается по серверному elapsed + клиентскому времени с последнего ответа.
 * Так клиент не убегает вперёд сервера (учитывается сетевая задержка запуска)
 * и не останавливается из-за разницы часов.
 */
function RocketScene({
  serverClockRef,
  frozenRef,
  crashedRef,
  multRef,
  cashRef,
  betRef,
  resetRef,
  serverMultRef,
  shownRef,
}: {
  serverClockRef: ServerClockRef;
  frozenRef: NullableNumberRef;
  crashedRef: BoolRef;
  multRef: TextRef;
  cashRef: TextRef;
  betRef: NumberRef;
  resetRef: NumberRef;
  serverMultRef: NumberRef;
  shownRef: NumberRef;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
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

      // Новый раунд — начинаем с единицы без плавного «докатывания» назад.
      if (resetRef.current !== lastReset) {
        lastReset = resetRef.current;
        shown = 1;
      }

      // Целевое значение: серверное elapsed + клиентское время с момента получения ответа.
      const frozen = frozenRef.current;
      let target: number;
      if (frozen !== null) {
        target = frozen;
      } else {
        const clock = serverClockRef.current;
        let elapsed: number;
        if (clock) {
          elapsed = clock.elapsed + (Date.now() - clock.receivedAtMs) / 1000;
        } else {
          elapsed = 0;
        }
        target = multFromElapsed(elapsed);
        // Не опускаемся ниже последнего значения сервера (на случай старых бэкендов).
        if (target < serverMultRef.current) target = serverMultRef.current;
      }

      // Лёгкое сглаживание: убирает микропрыжки, но не добавляет задержки.
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

      // Переходим в координаты сцены 360×260.
      ctx.setTransform((cssW / W) * dpr, 0, 0, (cssH / H) * dpr, 0, 0);

      const u = progressOf(shown);

      // призрачная траектория
      strokeCurve(ctx, 1, "rgba(255, 255, 255, 0.06)", 2);

      // пройденный путь
      strokeCurve(ctx, u, "rgba(255, 47, 126, 0.2)", 11);
      const trail = ctx.createLinearGradient(0, H, W, 0);
      trail.addColorStop(0, "#a01a52");
      trail.addColorStop(0.45, "#ff2f7e");
      trail.addColorStop(1, "#ff7aa8");
      strokeCurve(ctx, u, trail, 4.6);
      strokeCurve(ctx, u, "rgba(255, 214, 232, 0.55)", 1.2);

      // монеты
      drawCoin(ctx, 268, 88, time, 0);
      drawCoin(ctx, 314, 150, time, 1.7);
      drawCoin(ctx, 224, 110, time, 3.1);

      // ракета парит над кривой: позиция зависит от прогресса, а не от самой линии
      const rx = 118 + (258 - 118) * u;
      const ry = 176 + (96 - 176) * u + Math.sin(time * 3) * 2.5;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(-0.42 - 0.1 * u);
      drawRocket(ctx, time, crashedRef.current);
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
  }, [serverClockRef, frozenRef, crashedRef, multRef, cashRef, betRef, resetRef, serverMultRef, shownRef]);

  return <canvas ref={canvasRef} className="rk-canvas" aria-hidden="true" />;
}

export default function RocketGame({ balance, starsPerTon, telegramId, onBalance, onChanged, onDeposit }: GameProps) {
  const [bet, setBet] = useState(1);
  const [betInput, setBetInput] = useState("1");
  const [game, setGame] = useState<ServerRocketGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<number[]>([]);

  const polling = useRef(false);
  const statusRef = useRef("");
  const multRef = useRef<HTMLSpanElement>(null);
  const cashRef = useRef<HTMLSpanElement>(null);
  const betRef = useRef(1);
  const frozenRef = useRef<number | null>(null);
  const crashedRef = useRef(false);
  const resetRef = useRef(0);
  const serverMultRef = useRef(1);
  const shownRef = useRef(1);
  const serverClockRef = useRef<{ elapsed: number; receivedAtMs: number } | null>(null);

  const phase =
    game?.status === "active" ? "running" : game?.status === "lost" ? "crashed" : game?.status === "won" ? "cashed" : "ready";
  const payout = game?.payout_ton ?? 0;

  betRef.current = bet;

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
    if (phase !== "running" || !game) return;
    const sessionId = game.session_id;
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void api
        .checkRocket(telegramId, sessionId)
        .then((result) => {
          // Сервер прислал elapsed (секунды с начала раунда по серверу).
          // Запоминаем его и клиентское время получения — между ответами
          // прибавляем только клиентское время, так нет рассинхрона часов.
          serverMultRef.current = Math.max(1, result.multiplier);
          if (typeof result.elapsed === "number" && result.elapsed >= 0) {
            serverClockRef.current = { elapsed: result.elapsed, receivedAtMs: Date.now() };
          }

          if (result.status !== "active") {
            frozenRef.current = result.status === "won" ? result.multiplier : (result.crash_multiplier ?? result.multiplier);
            crashedRef.current = result.status !== "won";
          }

          // React перерисовываем только при смене статуса — не 3 раза в секунду.
          if (result.status !== statusRef.current) {
            statusRef.current = result.status;
            setGame(result);
            if (result.status !== "active") {
              onBalance(result.balance_stars, result.balance_ton);
              onChanged();
              loadHistory();
            }
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Не удалось обновить раунд"))
        .finally(() => {
          polling.current = false;
        });
    }, 250);
    return () => window.clearInterval(timer);
  }, [game?.session_id, phase, telegramId, onBalance, onChanged]);

  async function launch() {
    if (busy || !Number.isFinite(bet) || bet < 0.01 || bet > 100_000) return;
    if (balance < bet) return onDeposit();
    resetRef.current += 1;
    serverClockRef.current = null;
    frozenRef.current = null;
    crashedRef.current = false;
    serverMultRef.current = 1;
    statusRef.current = "active";
    setBusy(true);
    setError("");
    try {
      const result = await api.startRocket(telegramId, Math.max(1, Math.round(bet * starsPerTon)));
      if (typeof result.elapsed === "number" && result.elapsed >= 0) {
        serverClockRef.current = { elapsed: result.elapsed, receivedAtMs: Date.now() };
      }
      serverMultRef.current = Math.max(1, result.multiplier);
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      statusRef.current = "";
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
    // Замораживаем множитель на момент клика — во время запроса он не должен расти.
    frozenRef.current = shownRef.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.cashoutRocket(telegramId, game.session_id);
      serverClockRef.current = null;
      frozenRef.current = result.multiplier;
      crashedRef.current = false;
      serverMultRef.current = Math.max(1, result.multiplier);
      statusRef.current = result.status;
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось забрать выигрыш");
    } finally {
      setBusy(false);
    }
  }

  const crashMult = game?.crash_multiplier ?? game?.multiplier ?? 1;

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
          <span ref={multRef} />
        </b>

        <RocketScene
          serverClockRef={serverClockRef}
          frozenRef={frozenRef}
          crashedRef={crashedRef}
          multRef={multRef}
          cashRef={cashRef}
          betRef={betRef}
          resetRef={resetRef}
          serverMultRef={serverMultRef}
          shownRef={shownRef}
        />

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
          {busy ? "Забираем…" : <>Забрать <b ref={cashRef} /></>}
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
