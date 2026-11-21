import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type SnowfallGame as GameState } from "../api";
import { fmt } from "../lib/format";
import { getTelegramId, tg } from "../telegram";
import { Ton } from "../ui/Icons";

type Props = {
  balance: number;
  starsPerTon: number;
  onBalance: (stars: number, ton: number) => void;
  onChanged: () => void;
  onDeposit: () => void;
};

const BETS = [0.5, 1, 2, 5];
const HIT_ANIMATION_MS = 720;

function getTargetRow(state: GameState): number {
  const firstVisible = Math.max(0, Math.min(state.progress - 3, state.blocks.length - 5));
  const targetIndex = state.blocks.findIndex((block) => !block.destroyed);
  return targetIndex < 0 ? 4 : Math.max(0, Math.min(4, targetIndex - firstVisible));
}

export default function SnowfallGame({ balance, starsPerTon, onBalance, onChanged, onDeposit }: Props) {
  const [game, setGame] = useState<GameState | null>(null);
  const [bet, setBet] = useState(1);
  const [betInput, setBetInput] = useState("1");
  const [falling, setFalling] = useState(false);
  const [toolDistance, setToolDistance] = useState(-20);
  const [flightDistance, setFlightDistance] = useState(15);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const telegramId = getTelegramId();
  const betStars = Number.isFinite(bet) && bet >= 0.01 && bet <= 100_000 ? Math.max(1, Math.round(bet * starsPerTon)) : 0;

  useEffect(() => {
    let live = true;
    api.getSnowfall(telegramId)
      .then(({ game: current }) => { if (live) setGame(current); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [telegramId]);

  const visibleBlocks = useMemo(() => {
    if (!game) return [];
    const from = Math.max(0, Math.min(game.progress - 3, game.blocks.length - 5));
    return game.blocks.slice(from, from + 5).map((block, i) => ({ ...block, index: from + i }));
  }, [game]);
  const toolPercent = game ? Math.max(0, (game.tool.durability / game.tool.max_durability) * 100) : 100;
  const progressPercent = game ? Math.min(100, (game.progress / game.target) * 100) : 0;
  const currentBlock = visibleBlocks.find((block) => !block.destroyed);
  const fallStyle = {
    "--tool-distance": `${toolDistance}px`,
    "--fall-distance": `${flightDistance}px`,
    "--rest-distance": game ? `${toolDistance}px` : "-20px",
  } as CSSProperties;

  function updateBet(value: number) {
    setBet(value);
    setBetInput(String(value));
  }

  async function animateHit(activeGame: GameState) {
    const fromRow = getTargetRow(activeGame);
    const block = activeGame.blocks.find((item) => !item.destroyed);
    const destinationRow = Math.min(4, fromRow + (block && block.hp <= 1 ? 1 : 0));
    const destination = destinationRow * 53 + 35;
    setFlightDistance(destination);
    setFalling(true);
    const animation = new Promise<void>((resolve) => window.setTimeout(resolve, HIT_ANIMATION_MS));
    try {
      const result = await api.hitSnowfall(telegramId, activeGame.session_id);
      setGame(result);
      await animation;
      setToolDistance(destination);
      tg?.HapticFeedback?.impactOccurred(result.progress > activeGame.progress ? "heavy" : "light");
      if (result.progress > activeGame.progress) tg?.HapticFeedback?.notificationOccurred("success");
      return result;
    } catch (err) {
      await animation;
      throw err;
    } finally {
      setFalling(false);
    }
  }

  async function start() {
    if (!Number.isFinite(bet) || bet < 0.01 || bet > 100_000) return;
    if (balance < bet) return onDeposit();
    setBusy(true); setError("");
    try {
      const started = await api.startSnowfall(telegramId, betStars);
      setGame(started);
      onBalance(started.balance_stars, started.balance_ton);
      tg?.HapticFeedback?.impactOccurred("medium");
      void onChanged();
      if (started.status === "active") await animateHit(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать раунд");
    } finally { setBusy(false); }
  }

  async function hit() {
    if (!game || busy || game.status !== "active") return;
    setBusy(true); setError("");
    try {
      await animateHit(game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Удар не прошёл");
    } finally { setBusy(false); }
  }

  async function openChest() {
    if (!game || busy) return;
    setBusy(true); setOpening(true); setError("");
    window.setTimeout(async () => {
      try {
        const result = await api.openSnowfall(telegramId, game.session_id);
        setGame(result);
        onBalance(result.balance_stars, result.balance_ton);
        tg?.HapticFeedback?.notificationOccurred("success");
        void onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Сундук не открылся");
      } finally { setOpening(false); setBusy(false); }
    }, 650);
  }

  const reward = game?.reward;

  return (
    <div className="snowfall">
      <div className="snowfall-heading">
        <div><span className="snowfall-kicker">ЗИМНИЙ ИВЕНТ</span><h3>Ледяная шахта</h3></div>
        <div className="snowfall-wallet"><Ton size={16} /><b>{fmt(balance)}</b></div>
      </div>

      <div className="snowfall-status">
        <span><small>Прогресс до сундука</small><b>{game?.progress ?? 0}<i> / {game?.target ?? 8}</i></b></span>
        <div className="snowfall-progress"><i style={{ width: `${progressPercent}%` }} /></div>
      </div>

      <div className={`snowfall-field ${falling ? "is-falling" : ""} ${game?.status === "chest" ? "has-chest" : ""}`}>
        {game && game.status !== "opened" && <img className={`snowfall-tool ${falling ? "drop" : ""}`} style={fallStyle} src="/snowfall/pickaxe.gif" alt="" aria-hidden="true" />}
        <div className="snowfall-board" aria-label="Поле ледяных блоков">
          {Array.from({ length: 25 }, (_, cellIndex) => {
            const row = Math.floor(cellIndex / 5);
            const col = cellIndex % 5;
            const block = col === 2 ? visibleBlocks[row] : null;
            const isTarget = Boolean(block && !block.destroyed && block.index === game?.progress);
            return (
              <div key={`${cellIndex}-${block?.index ?? "ice"}`} className={`snowfall-cell ${block ? `block-${block.kind}` : "block-decor"} ${block?.destroyed ? "destroyed" : ""} ${isTarget ? "target" : ""}`}>
                {block ? <>
                  <span className="snowfall-block-emoji">{block.destroyed ? "✧" : ["✦", "◇", "◈", "◆"][block.max_hp - 1] ?? "◇"}</span>
                  {!block.destroyed && <small>{block.hp}<i>/{block.max_hp}</i></small>}
                </> : null}
              </div>
            );
          })}
        </div>
        <div className={`snowfall-chest-row ${game?.status === "chest" ? "ready" : ""} ${opening ? "opening" : ""} ${game?.status === "opened" ? "opened" : ""}`} aria-label="Сундуки с наградами">
          {Array.from({ length: 5 }, (_, index) => {
            const isOpen = game?.status === "opened" && index === 2;
            const isOpening = opening && index === 2;
            return <span key={index} className={`snowfall-chest ${isOpen ? "open" : ""}`} aria-hidden="true"><i>{isOpen ? "✨" : isOpening ? "🔓" : "🔒"}</i></span>;
          })}
        </div>
      </div>

      {game?.status === "opened" && reward ? (
        <div className="snowfall-reward">
          <span className="snowfall-reward-art">{reward.kind === "nft" ? "💎" : reward.emoji}</span>
          <small>{reward.kind === "nft" ? "РЕДКИЙ NFT" : reward.kind === "gift" ? "ПОДАРОК" : "НАГРАДА ИЗ СУНДУКА"}</small>
          <b>{reward.name}</b>
          {reward.kind === "stars" && <strong>+{fmt(reward.stars / starsPerTon)} <Ton size={16} /></strong>}
          {reward.kind !== "stars" && <p>Предмет добавлен в инвентарь</p>}
        </div>
      ) : game?.status === "chest" ? (
        <div className="snowfall-chest-copy"><b>Сундук найден!</b><small>Открывай и забирай награду раунда</small></div>
      ) : game?.status === "active" ? (
        <div className="snowfall-tool-info">
          <span className="snowfall-tool-badge"><img src="/snowfall/pickaxe.gif" alt="" /></span>
          <span><b>{game.tool.name}</b><small>{game.tool.rarity} · ставка {fmt(game.bet_ton)} TON · прочность {game.tool.durability}/{game.tool.max_durability}</small></span>
          <div className="snowfall-durability"><i style={{ width: `${toolPercent}%` }} /></div>
        </div>
      ) : (
        <div className="snowfall-intro"><b>Разбей лёд. Открой сундук.</b><small>Каждый блок двигает шкалу награды. Баланс за удары не начисляется.</small></div>
      )}

      {!game && (
        <div className="snowfall-bet">
          <small>Ставка раунда</small>
          <div>{BETS.map((amount) => <button key={amount} className={bet === amount ? "selected" : ""} onClick={() => updateBet(amount)} disabled={Boolean(game) || busy}>{fmt(amount)} <Ton size={13} /></button>)}</div>
          <label className="snowfall-custom-bet"><span>Своя ставка · от 0,01 TON</span><span className="snowfall-bet-input"><input type="text" inputMode="decimal" value={betInput} onChange={(event) => { const value = event.target.value.replace(",", "."); setBetInput(value); setBet(Number(value) || 0); }} disabled={busy} /><Ton size={15} /></span></label>
        </div>
      )}

      {error && <p className="notice bad">{error}</p>}
      {loading ? <button className="btn primary wide" disabled>Загружаем шахту…</button> :
        game?.status === "active" ? <button className="btn gold wide snowfall-action" onClick={hit} disabled={busy}>{falling ? "Удар!" : busy ? "..." : currentBlock ? "Крутить · ударить лёд" : "Крутить"}</button> :
        game?.status === "chest" ? <button className="btn gold wide snowfall-action" onClick={openChest} disabled={busy}>{opening ? "Сундук открывается…" : "Открыть сундук"}</button> :
        game?.status === "opened" ? <button className="btn primary wide snowfall-action" onClick={() => setGame(null)}>Играть ещё раз</button> :
        <button className="btn primary wide snowfall-action" onClick={start} disabled={busy || betStars <= 0}>{busy ? "Кирка в деле…" : "Играть"}</button>}

      <div className="snowfall-odds"><span>🎁</span><p>При прогрессе 5+ шанс редкого подарка — 4%; на полном поле — ещё 0,5% шанс NFT.</p></div>
      <div className="snowfall-tool-pool" aria-label="Редкость инструментов">
        <small>ИНСТРУМЕНТЫ</small>
        <span>❄ Обычный <b>52%</b></span><span>🔹 Необычный <b>28%</b></span><span>💠 Редкий <b>14%</b></span><span>💎 Эпический <b>5%</b></span><span>🌟 Легендарный <b>1%</b></span>
      </div>
    </div>
  );
}
