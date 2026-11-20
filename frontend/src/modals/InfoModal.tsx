import Sheet from "../ui/Sheet";
import { Ton } from "../ui/Icons";

export type Transaction = { id: number; label: string; amount: number; date: string };

export default function InfoModal({
  title,
  onClose,
  transactions,
}: {
  title: string;
  onClose: () => void;
  transactions: Transaction[];
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      {title === "История операций" &&
        (transactions.length === 0 ? (
          <p className="empty">Операций пока нет. Открой кейс или пополни баланс.</p>
        ) : (
          <ul className="history">
            {transactions.map((t) => (
              <li key={t.id}>
                <span>
                  <b>{t.label}</b>
                  <small>{t.date}</small>
                </span>
                <em className={t.amount > 0 ? "plus" : "minus"}>
                  {t.amount > 0 ? "+" : "−"}
                  {Math.abs(Number(t.amount.toFixed(2)))}
                  <Ton size={13} />
                </em>
              </li>
            ))}
          </ul>
        ))}
      {title === "Мои подарки" && <p className="empty">Здесь появятся выигранные подарки. Сейчас призы из кейсов зачисляются на баланс.</p>}
      {title === "Настройки" && (
        <div className="menu">
          <button className="menu-row" onClick={() => window.location.reload()}>
            <span className="menu-text">
              <b>Обновить данные</b>
              <small>Баланс и история хранятся на сервере и не сбросятся</small>
            </span>
          </button>
        </div>
      )}
    </Sheet>
  );
}
