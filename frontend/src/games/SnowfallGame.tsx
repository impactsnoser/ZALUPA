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

export default function SnowfallGame({ balance, starsPerTon, onBalance, onChanged, onDeposit }: Props) {
  const [game, setGame] = useState<GameState | null>(null);
  const [bet, setBet] = useState(1);
  const [falling, setFalling] = useState(false);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const telegramId = getTelegramId();
  const betStars = Math.max(1, Math.round(bet * starsPerTon));

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
  const targetRow = Math.max(0, visibleBlocks.findIndex((block) => !block.destroyed));
  const fallStyle = { "--fall-distance": `${targetRow * 53 + 35}px` } as CSSProperties;

  async function start() {
    if (balance < bet) return onDeposit();
    setBusy(true); setError("");
    try {
      const result = await api.startSnowfall(telegramId, betStars);
      setGame(result);
      onBalance(result.balance_stars, result.balance_ton);
      tg?.HapticFeedback?.impactOccurred("medium");
      void onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать раунд");
    } finally { setBusy(false); }
  }

  async function hit() {
    if (!game || busy || game.status !== "active") return;
    setBusy(true); setError(""); setFalling(true);
    window.setTimeout(async () => {
      try {
        const result = await api.hitSnowfall(telegramId, game.session_id);
        setGame(result);
        tg?.HapticFeedback?.impactOccurred(result.progress > game.progress ? "heavy" : "light");
        if (result.progress > game.progress) tg?.HapticFeedback?.notificationOccurred("success");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Удар не прошёл");
      } finally {
        setFalling(false); setBusy(false);
      }
    }, 520);
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
        <img className={`snowfall-tool ${falling ? "drop" : ""}`} style={fallStyle} src="/snowfall/pickaxe.gif" alt="" aria-hidden="true" />
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
          <span><b>{game.tool.name}</b><small>{game.tool.rarity} · прочность {game.tool.durability}/{game.tool.max_durability}</small></span>
          <div className="snowfall-durability"><i style={{ width: `${toolPercent}%` }} /></div>
        </div>
      ) : (
        <div className="snowfall-intro"><b>Разбей лёд. Открой сундук.</b><small>Каждый блок двигает шкалу награды. Баланс за удары не начисляется.</small></div>
      )}

      {game?.status !== "opened" && game?.status !== "chest" && (
        <div className="snowfall-bet">
          <small>Ставка раунда</small>
          <div>{BETS.map((amount) => <button key={amount} className={bet === amount ? "selected" : ""} onClick={() => setBet(amount)} disabled={Boolean(game) || busy}>{fmt(amount)} <Ton size={13} /></button>)}</div>
        </div>
      )}

      {error && <p className="notice bad">{error}</p>}
      {loading ? <button className="btn primary wide" disabled>Загружаем шахту…</button> :
        game?.status === "active" ? <button className="btn gold wide snowfall-action" onClick={hit} disabled={busy}>{falling ? "Удар!" : busy ? "..." : currentBlock ? "Крутить · ударить лёд" : "Крутить"}</button> :
        game?.status === "chest" ? <button className="btn gold wide snowfall-action" onClick={openChest} disabled={busy}>{opening ? "Сундук открывается…" : "Открыть сундук"}</button> :
        game?.status === "opened" ? <button className="btn primary wide snowfall-action" onClick={() => setGame(null)}>Играть ещё раз</button> :
        <button className="btn primary wide snowfall-action" onClick={start} disabled={busy}>{busy ? "Готовим инструмент…" : "Играть"}</button>}

      <div className="snowfall-odds"><span>🎁</span><p>При прогрессе 5+ шанс редкого подарка — 4%; на полном поле — ещё 0,5% шанс NFT.</p></div>
      <div className="snowfall-tool-pool" aria-label="Редкость инструментов">
        <small>ИНСТРУМЕНТЫ</small>
        <span>❄ Обычный <b>52%</b></span><span>🔹 Необычный <b>28%</b></span><span>💠 Редкий <b>14%</b></span><span>💎 Эпический <b>5%</b></span><span>🌟 Легендарный <b>1%</b></span>
      </div>
    </div>
  );
}
