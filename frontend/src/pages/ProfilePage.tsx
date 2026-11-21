import { useCallback, useEffect, useState } from "react";
import { api, type InventoryItem, type SellResult } from "../api";
import { fmt } from "../lib/format";
import { Glyph, Ton } from "../ui/Icons";
import Sheet from "../ui/Sheet";

function InventoryArtwork({ item }: { item: InventoryItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.image_url || failed) {
    return <span className="inventory-card-emoji">{item.emoji ?? "🎁"}</span>;
  }
  return <img src={item.image_url} alt={item.name} className="inventory-card-img" loading="lazy" onError={() => setFailed(true)} />;
}

export default function ProfilePage({
  name,
  handle,
  initial,
  balance,
  stars,
  telegramId,
  games,
  isAdmin,
  onDeposit,
  onAdmin,
  onSold,
  onMenu,
}: {
  name: string;
  handle: string;
  initial: string;
  balance: number;
  stars: number;
  telegramId: number;
  games: number;
  isAdmin: boolean;
  onDeposit: () => void;
  onAdmin: () => void;
  onSold: (result: SellResult) => void;
  onMenu: (label: string) => void;
}) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sellBusy, setSellBusy] = useState<Set<number>>(new Set());
  const [withdrawBusy, setWithdrawBusy] = useState<Set<number>>(new Set());

  const loadInventory = useCallback(async () => {
    try {
      const data = await api.getInventory(telegramId);
      setInventory(data.items ?? []);
    } catch {
      setInventory([]);
    } finally {
      setLoading(false);
    }
  }, [telegramId]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const handleSell = async (item: InventoryItem) => {
    setSellBusy((cur) => new Set([...cur, item.inventory_id]));
    try {
      const result = await api.sellInventoryItem(telegramId, item.inventory_id);
      setInventory((cur) => cur.filter((i) => i.inventory_id !== item.inventory_id));
      // Сразу обновляем баланс в App — без ожидания перезагрузки кошелька.
      onSold(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Не удалось продать предмет");
    } finally {
      setSellBusy((cur) => {
        const next = new Set(cur);
        next.delete(item.inventory_id);
        return next;
      });
    }
  };

  const handleWithdraw = async (item: InventoryItem) => {
    setWithdrawBusy((cur) => new Set([...cur, item.inventory_id]));
    try {
      const result = await api.withdrawInventoryItem(telegramId, item.inventory_id);
      setInventory((cur) => cur.filter((i) => i.inventory_id !== item.inventory_id));
      alert(result.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Не удалось вывести предмет");
    } finally {
      setWithdrawBusy((cur) => {
        const next = new Set(cur);
        next.delete(item.inventory_id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <section className="page">
        <div className="profile-head">
          <span className="avatar big">{initial}</span>
          <div>
            <h1 className="page-title tight">{name}</h1>
            <small className="muted">{handle}</small>
          </div>
        </div>
        <p className="empty">Загружаем инвентарь…</p>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="profile-head">
        <span className="avatar big">{initial}</span>
        <div>
          <h1 className="page-title tight">{name}</h1>
          <small className="muted">{handle}</small>
        </div>
      </div>
      <div className="balance-card">
        <small>Баланс</small>
        <b>
          <Ton size={26} />
          {fmt(balance)}
        </b>
        <small className="balance-sub">
          {stars} ⭐ — общий баланс Stars и TON
        </small>
        <button className="btn primary" onClick={onDeposit}>
          Пополнить
        </button>
      </div>
      <div className="stats two">
        <div>
          <small>Открыто кейсов и игр</small>
          <b>{games}</b>
        </div>
        <div>
          <small>Подарков в инвентаре</small>
          <b>{inventory.length}</b>
        </div>
      </div>
      <div className="inventory-section">
        <h3 className="menu-section-title">Инвентарь</h3>
        {inventory.length === 0 ? (
          <p className="empty">Инвентарь пуст. Открой кейсы, чтобы получить предметы.</p>
        ) : (
          <div className="inventory-grid">
            {inventory.map((item) => (
              <article key={item.inventory_id} className={`inventory-card ${item.kind === "prize" ? "case-prize" : "catalog-gift"}`}>
                <div className="inventory-card-art">
                  <InventoryArtwork item={item} />
                  {item.is_nft && <span className="inventory-nft">NFT</span>}
                </div>
                <div className="inventory-card-info">
                  <div className="inventory-name" title={item.name}>{item.name}</div>
                  <div className="inventory-value">{item.price_stars} ⭐</div>
                </div>
                <div className="inventory-card-actions">
                  <button
                    className="inventory-action sell"
                    onClick={() => handleSell(item)}
                    disabled={sellBusy.has(item.inventory_id)}
                  >
                    {sellBusy.has(item.inventory_id) ? "…" : "Продать"}
                  </button>
                  <button
                    className="inventory-action withdraw"
                    onClick={() => handleWithdraw(item)}
                    disabled={withdrawBusy.has(item.inventory_id)}
                  >
                    {withdrawBusy.has(item.inventory_id) ? "…" : "Получить"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="menu">
        <h3 className="menu-section-title">Разделы</h3>
        {["История операций", "Друзья", "Настройки", isAdmin ? "Админ-панель" : ""].filter((label) => label).map((label) => {
          const isAdminPanel = label === "Админ-панель";
          return (
            <button
              key={label}
              className="menu-row"
              onClick={() => isAdminPanel ? void onAdmin() : onMenu(label)}
              disabled={isAdmin && !isAdmin}
            >
              <span className="menu-text">
                <b>{label}</b>
              </span>
              <Glyph name="chevron" size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
