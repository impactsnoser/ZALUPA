import { useState } from "react";
import { tg } from "../telegram";
import { Glyph, Ton } from "../ui/Icons";
import Sheet from "../ui/Sheet";

export type PaymentMethod = "crypto" | "stars" | "nft";

const LABEL: Record<PaymentMethod, string> = {
  crypto: "Криптовалюта",
  stars: "Telegram Stars",
  nft: "NFT-подарок",
};

export default function DepositModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (amount: number, method: PaymentMethod) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState(25);
  const [done, setDone] = useState(false);

  function submit() {
    if (!method) return;
    onComplete(amount, method);
    setDone(true);
    tg?.HapticFeedback?.notificationOccurred("success");
  }

  return (
    <Sheet title={done ? "Баланс пополнен" : method ? LABEL[method] : "Пополнение"} onClose={onClose}>
      {done ? (
        <div className="stack">
          <p className="lead">
            Зачислено {amount} TON способом «{method && LABEL[method]}».
          </p>
          <button className="btn primary wide" onClick={onClose}>
            Вернуться
          </button>
        </div>
      ) : method ? (
        <div className="stack">
          <button className="link-btn" onClick={() => setMethod(null)}>
            <Glyph name="back" size={16} /> Другой способ
          </button>
          {method === "nft" && (
            <p className="lead">Отправь подарок боту. После оценки сумма появится на балансе. Для демо выбери сумму оценки.</p>
          )}
          {method === "stars" && <p className="lead">Оплата идёт через счёт Telegram Stars. Для демо выбери сумму.</p>}
          {method === "crypto" && <p className="lead">Выбери сумму пополнения в TON.</p>}
          <div className="chips">
            {[10, 25, 50, 100].map((v) => (
              <button key={v} className={`chip${amount === v ? " on" : ""}`} onClick={() => setAmount(v)}>
                <Ton size={14} />
                {v}
              </button>
            ))}
          </div>
          <button className="btn primary wide" onClick={submit}>
            {method === "nft" ? "Подтвердить оценку" : `Пополнить на ${amount}`}
          </button>
        </div>
      ) : (
        <div className="menu">
          {(
            [
              ["crypto", "Криптовалюта", "TON, USDT и другие"],
              ["stars", "Telegram Stars", "Зачисляются сразу"],
              ["nft", "NFT-подарок", "Оценим и зачислим"],
            ] as [PaymentMethod, string, string][]
          ).map(([id, title, hint]) => (
            <button key={id} className="menu-row" onClick={() => setMethod(id)}>
              <span className={`menu-ico pay-${id}`}>{id === "crypto" ? <Ton size={22} /> : id === "stars" ? "★" : "🎁"}</span>
              <span className="menu-text">
                <b>{title}</b>
                <small>{hint}</small>
              </span>
              <Glyph name="chevron" size={16} />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
