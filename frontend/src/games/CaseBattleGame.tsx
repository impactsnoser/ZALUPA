import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, type BattleCase, type BattleRoom } from "../api";
import { CASES as CASE_DEFS } from "../data/cases";
import { fmt } from "../lib/format";
import { PALETTES } from "../ui/GiftBox";
import { Ton } from "../ui/Icons";

type LobbyRoom = { battle_id: string; username: string; case: BattleCase; bet_stars: number; bet_ton: number; expires_at: number };
type ReelItem = { name: string; valueStars: number; imageUrl: string };

function reelItems(battleId: string, playerIndex: number, battleCase: BattleCase, result: NonNullable<BattleRoom["result"]>["you"], otherPrize: NonNullable<BattleRoom["result"]>["you"]) {
  const previews: ReelItem[] = battleCase.prizes?.length
    ? battleCase.prizes.map((item) => ({ name: item.name, valueStars: Math.round(item.value * 100), imageUrl: item.image_url }))
    : [result, otherPrize].filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => ({
      name: item.name, valueStars: item.value_stars, imageUrl: item.image_url ?? "",
    }));
  if (!result || previews.length === 0) return [];
  const seed = [...battleId].reduce((total, char) => total + char.charCodeAt(0), playerIndex * 29);
  const spins = Array.from({ length: 18 }, (_, index) => previews[(seed + index * 7) % previews.length]);
  return [...spins, { name: result.name, valueStars: result.value_stars, imageUrl: result.image_url ?? "" }];
}

function BattleReel({ battle, prize, otherPrize, playerIndex, label, duration }: {
  battle: BattleRoom; prize: NonNullable<BattleRoom["result"]>["you"]; otherPrize: NonNullable<BattleRoom["result"]>["you"]; playerIndex: number; label: string; duration: number;
}) {
  const items = reelItems(battle.battle_id, playerIndex, battle.case, prize, otherPrize);
  const reelStyle = {
    "--reel-end": `${-Math.max(0, items.length - 1) * 80}px`,
    "--reel-duration": `${Math.max(250, duration)}ms`,
  } as CSSProperties;
  return (
    <div className="battle-reel-card">
      <label>{label}</label>
      <div className="battle-reel-window">
        <div className="battle-reel-track" style={reelStyle}>
          {items.map((item, index) => (
            <div className="battle-reel-item" key={`${item.name}-${index}`}>
              <img src={item.imageUrl} alt="" />
              <span>{item.name}</span>
              <small>{fmt(item.valueStars / 100)} TON</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CaseBattleGame({ telegramId, starsPerTon, onDeposit, onChanged }: {
  telegramId: number; starsPerTon: number; onDeposit: () => void; onChanged: () => void;
}) {
  const [cases, setCases] = useState<BattleCase[]>([]);
  const [selectedCase, setSelectedCase] = useState("");
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [battle, setBattle] = useState<BattleRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revealedBattleId, setRevealedBattleId] = useState<string | null>(null);
  const [revealDeadline, setRevealDeadline] = useState(0);

  function applyBattle(updated: BattleRoom) {
    if (updated.status === "completed" && updated.result) {
      const now = Date.now();
      const serverDeadline = updated.reveal_at ?? 0;
      setRevealDeadline(serverDeadline > now + 250 ? serverDeadline : now + 3200);
      setRevealedBattleId(null);
    }
    setBattle(updated);
  }

  const refreshLobby = useCallback(async () => {
    try {
      const [lobby, mine] = await Promise.all([api.getBattleLobby(telegramId), api.getMyBattle(telegramId)]);
      setRooms(lobby.rooms);
      if (!battle && mine.battle) setBattle(mine.battle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить комнаты");
    }
  }, [telegramId, battle]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getBattleCases(), api.getBattleLobby(telegramId), api.getMyBattle(telegramId)])
      .then(([availableCases, lobby, mine]) => {
        if (!alive) return;
        setCases(availableCases);
        setSelectedCase((current) => current || availableCases[0]?.id || "");
        setRooms(lobby.rooms);
        if (mine.battle) setBattle(mine.battle);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Не удалось открыть битвы"));
    return () => { alive = false; };
  }, [telegramId]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refreshLobby(); }, 3500);
    return () => window.clearInterval(timer);
  }, [refreshLobby]);

  useEffect(() => {
    if (!battle || battle.status !== "waiting") return;
    const timer = window.setInterval(() => {
      api.getBattle(battle.battle_id, telegramId).then((updated) => {
        applyBattle(updated);
        if (updated.status !== "waiting") onChanged();
      }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Не удалось обновить битву"));
    }, 650);
    return () => window.clearInterval(timer);
  }, [battle?.battle_id, battle?.status, telegramId, onChanged]);

  useEffect(() => {
    if (!battle || battle.status !== "completed" || !battle.result || revealedBattleId === battle.battle_id) return;
    const delay = Math.max(0, (revealDeadline || Date.now() + 3200) - Date.now());
    const timer = window.setTimeout(() => setRevealedBattleId(battle.battle_id), delay);
    return () => window.clearTimeout(timer);
  }, [battle?.battle_id, battle?.status, battle?.result, revealDeadline, revealedBattleId]);

  async function act(action: () => Promise<BattleRoom>) {
    setBusy(true);
    setError("");
    try {
      const updated = await action();
      applyBattle(updated);
      onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось выполнить действие";
      setError(message);
      if (message.includes("Недостаточно средств")) onDeposit();
    } finally {
      setBusy(false);
    }
  }

  const statusMessage = battle?.status === "waiting"
    ? "Ищем соперника… комната открыта 3 минуты"
    : battle?.status === "expired" ? "Время комнаты истекло, ставка возвращена"
      : battle?.status === "cancelled" ? "Комната отменена, ставка возвращена" : "";

  return (
    <div className="stack case-battle">
      {battle?.status !== "completed" && <section className="battle-panel">
        <div className="battle-eyebrow">⚔️ ИГРА ПРОТИВ ЧЕЛОВЕКА</div>
        <h3>Битва кейсов</h3>
        <p className="muted">Выбери кейс. Оба игрока оплачивают его цену и открывают одновременно. Победитель забирает оба подарка, при ничьей каждый оставляет свой.</p>
        {!battle || battle.status !== "waiting" ? (
          <>
            <div className="battle-case-list">
              {cases.map((item) => {
                const definition = CASE_DEFS.find((candidate) => candidate.id === item.id);
                const palette = PALETTES[definition?.box ?? "ice"] ?? PALETTES.ice;
                const featured = definition
                  ? [...definition.prizes].sort((a, b) => b.value - a.value).slice(0, 3)
                  : [];
                return (
                  <button
                    key={item.id}
                    className={`battle-case${selectedCase === item.id ? " selected" : ""}`}
                    style={{ "--glow": palette.glow } as CSSProperties}
                    onClick={() => setSelectedCase(item.id)}
                  >
                    <span className="case-highlights battle-case-art" aria-hidden="true">
                      {featured.map((prize, index) => (
                        <span className={`case-highlight case-highlight-${index + 1}`} key={prize.id}>
                          <img src={`/prizes/${prize.image}`} alt="" loading="lazy" draggable={false} />
                        </span>
                      ))}
                    </span>
                    <b>{item.title}</b>
                    <span><Ton size={14} /> {fmt(item.price)}</span>
                  </button>
                );
              })}
            </div>
            <button className="btn gold wide" disabled={!selectedCase || busy} onClick={() => void act(() => api.createBattle(telegramId, selectedCase))}>
              Создать битву
            </button>
          </>
        ) : (
          <div className="battle-waiting">
            <span className="battle-spinner">⚔️</span>
            <b>Комната создана</b>
            <span>{battle.case.title} · ставка {fmt(battle.bet_ton)} TON</span>
            <small>{statusMessage}</small>
            <button className="btn secondary wide" disabled={busy} onClick={() => void act(() => api.cancelBattle(telegramId, battle.battle_id))}>Отменить и вернуть ставку</button>
          </div>
        )}
      </section>}

      {battle?.status === "completed" && battle.result && revealedBattleId !== battle.battle_id && (
        <section className="battle-result battle-opening">
          <div className="battle-eyebrow">🎁 ОТКРЫВАЕМ КЕЙСЫ</div>
          <h3>Оба игрока открывают призы</h3>
          <div className="battle-versus">
            <BattleReel battle={battle} prize={battle.result.you} otherPrize={battle.result.opponent} playerIndex={0} label="ТЫ" duration={Math.max(250, (revealDeadline || Date.now() + 3200) - Date.now())} />
            <BattleReel battle={battle} prize={battle.result.opponent} otherPrize={battle.result.you} playerIndex={1} label={battle.result.opponent_username} duration={Math.max(250, (revealDeadline || Date.now() + 3200) - Date.now())} />
          </div>
          <p className="muted">Сравниваем выпавшие подарки…</p>
        </section>
      )}

      {battle?.status === "completed" && battle.result && revealedBattleId === battle.battle_id && (
        <section className={`battle-result${battle.result.won ? " winner" : ""}`}>
          <div className="battle-eyebrow">{battle.result.draw ? "НИЧЬЯ" : battle.result.won ? "ПОБЕДА!" : "В ЭТОТ РАЗ НЕ ПОВЕЗЛО"}</div>
          <h3>{battle.result.draw ? "Каждый оставил свой приз" : battle.result.won ? "Ты забрал оба подарка" : `${battle.result.winner_username ?? "Соперник"} победил`}</h3>
          <div className="battle-versus">
            {[battle.result.you, battle.result.opponent].map((prize, index) => (
              <div className="battle-prize" key={`${prize?.name ?? "empty"}-${index}`}>
                {prize?.image_url ? <img src={prize.image_url} alt="" /> : <span>🎁</span>}
                <b>{prize?.name ?? "Приз"}</b>
                <small>{fmt((prize?.value_stars ?? 0) / starsPerTon)} TON</small>
                <label>{index === 0 ? "ТЫ" : battle.result?.opponent_username ?? "СОПЕРНИК"}</label>
              </div>
            ))}
          </div>
          {battle.result.you_receive_both && <p className="muted">Оба подарка добавлены в твой инвентарь.</p>}
          <button className="btn primary wide" onClick={() => { setBattle(null); onChanged(); }}>В лобби</button>
        </section>
      )}

      {statusMessage && battle?.status !== "waiting" && <div className="battle-notice">{statusMessage}<button onClick={() => setBattle(null)}>Продолжить</button></div>}
      {error && <p className="battle-error">{error}</p>}

      {!battle && (
        <section className="battle-lobby">
          <div className="battle-lobby-head"><h3>Открытые комнаты</h3><span>{rooms.length}</span></div>
          {rooms.length === 0 ? <p className="muted">Пока комнат нет. Создай битву — соперник сможет присоединиться.</p> : rooms.map((room) => (
            <div className="battle-room" key={room.battle_id}>
              <div><b>{room.username}</b><small>{room.case.title} · {fmt(room.bet_ton)} TON</small></div>
              <button className="btn gold" disabled={busy} onClick={() => void act(() => api.joinBattle(telegramId, room.battle_id))}>Играть</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
