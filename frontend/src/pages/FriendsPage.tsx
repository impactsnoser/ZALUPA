import { Glyph, Ton } from "../ui/Icons";

export default function FriendsPage({ link, onCopy, onInvite }: { link: string; onCopy: () => void; onInvite: () => void }) {
  return (
    <section className="page">
      <h1 className="page-title">Друзья</h1>
      <div className="ref-card">
        <strong className="ref-rate">10%</strong>
        <p>от каждого пополнения друга приходит к тебе на баланс</p>
      </div>
      <div className="stats two">
        <div>
          <small>Приглашено</small>
          <b>0</b>
        </div>
        <div>
          <small>Заработано</small>
          <b>
            0 <Ton size={16} />
          </b>
        </div>
      </div>
      <div className="link-field">
        <span>
          <small>Твоя ссылка</small>
          <b>{link.replace("https://", "")}</b>
        </span>
        <button className="icon-btn solid" onClick={onCopy} aria-label="Скопировать ссылку">
          <Glyph name="copy" />
        </button>
      </div>
      <button className="btn primary wide" onClick={onInvite}>
        Пригласить друга
      </button>
    </section>
  );
}
