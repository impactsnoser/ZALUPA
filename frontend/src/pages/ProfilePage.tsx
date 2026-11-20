import { fmt } from "../lib/format";
import { Glyph, Ton } from "../ui/Icons";

export default function ProfilePage({
  name,
  handle,
  initial,
  balance,
  stars,
  games,
  onDeposit,
  onMenu,
}: {
  name: string;
  handle: string;
  initial: string;
  balance: number;
  stars: number;
  games: number;
  onDeposit: () => void;
  onMenu: (label: string) => void;
}) {
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
        <small className="balance-sub">{stars} ⭐ — общий баланс Stars и TON</small>
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
          <b>0</b>
        </div>
      </div>
      <div className="menu">
        {["История операций", "Мои подарки", "Друзья", "Настройки"].map((label) => (
          <button key={label} className="menu-row" onClick={() => onMenu(label)}>
            <span className="menu-text">
              <b>{label}</b>
            </span>
            <Glyph name="chevron" size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
