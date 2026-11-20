import { useState } from "react";
import { api, type StarsInvoice, type TonInvoice, type Wallet } from "../api";
import { fmt } from "../lib/format";
import { tg } from "../telegram";
import { Glyph, Ton } from "../ui/Icons";
import Sheet from "../ui/Sheet";

type Method = "stars" | "ton";

const STAR_AMOUNTS = [100, 250, 500, 1000, 2500];
const TON_AMOUNTS = [1, 2, 5, 10];

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function DepositModal({
  telegramId,
  balanceStars,
  starsPerTon,
  tonEnabled,
  onClose,
  onCredited,
}: {
  telegramId: number;
  balanceStars: number;
  starsPerTon: number;
  tonEnabled: boolean;
  onClose: () => void;
  onCredited: (wallet: Wallet) => void;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [amount, setAmount] = useState(500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ stars: number; ton: number } | null>(null);
  const [pendingStars, setPendingStars] = useState<StarsInvoice | null>(null);
  const [tonInvoice, setTonInvoice] = useState<TonInvoice | null>(null);

  const tonRate = starsPerTon > 0 ? starsPerTon : 100;

  function choose(next: Method) {
    setMethod(next);
    setAmount(next === "stars" ? 500 : 2);
    setError("");
    setNote("");
    setDone(null);
    setPendingStars(null);
    setTonInvoice(null);
  }

  function success(wallet: Wallet, stars?: number, ton?: number) {
    onCredited(wallet);
    setDone({
      stars: stars ?? Math.max(0, wallet.balance_stars - balanceStars),
      ton: ton ?? Math.max(0, wallet.balance_ton - balanceStars / tonRate),
    });
    setNote("");
    setPendingStars(null);
    tg?.HapticFeedback?.notificationOccurred("success");
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNote(`${label} скопирован`);
    } catch {
      setNote(value);
    }
  }

  /** После оплаты вебхук Telegram зачисляет звёзды с небольшой задержкой. */
  async function waitForStarsCredit(invoice: StarsInvoice) {
    setNote("Оплата принята, зачисляем на баланс…");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await delay(1500);
      try {
        const wallet = await api.getWallet(telegramId);
        onCredited(wallet);
        if (wallet.balance_stars > balanceStars) {
          success(wallet, invoice.stars, invoice.amount_ton);
          return;
        }
      } catch {
        /* сеть моргнула — попробуем ещё раз */
      }
    }
    setNote("Оплата прошла. Баланс обновится в течение минуты — закройте и откройте окно.");
  }

  async function payStars() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const invoice = await api.depositStars(telegramId, amount);
      setPendingStars(invoice);
      if (tg?.openInvoice) {
        tg.openInvoice(invoice.invoice_link, (status) => {
          if (status === "paid") void waitForStarsCredit(invoice);
          else if (status === "cancelled") setError("Оплата отменена.");
          else if (status === "failed") setError("Оплата не прошла. Попробуйте ещё раз.");
          else setNote("Ожидаем подтверждение от Telegram…");
        });
      } else {
        setNote("Откройте счёт по кнопке ниже — оплата доступна внутри Telegram.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать счёт");
    } finally {
      setBusy(false);
    }
  }

  async function createTonInvoice() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const invoice = await api.depositTon(telegramId, amount);
      setTonInvoice(invoice);
      setNote("Переведите точную сумму с комментарием, затем нажмите «Проверить оплату».");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать счёт");
    } finally {
      setBusy(false);
    }
  }

  async function checkTon() {
    if (!tonInvoice) return;
    setBusy(true);
    setError("");
    setNote("Проверяем блокчейн…");
    try {
      const result = await api.checkTonDeposit(telegramId, tonInvoice.payment_id);
      if (result.status === "paid") {
        const wallet = await api.getWallet(telegramId);
        success(wallet, result.amount_stars ?? tonInvoice.amount_stars, result.amount_ton ?? tonInvoice.amount_ton);
      } else if (result.status === "expired") {
        setError("Счёт истёк. Создайте новый.");
      } else {
        setNote("Перевод пока не найден. Подождите 10–30 секунд и проверьте снова.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось проверить оплату");
    } finally {
      setBusy(false);
    }
  }

  const title = done
    ? "Баланс пополнен"
    : method === "stars"
      ? "Telegram Stars"
      : method === "ton"
        ? "TON"
        : "Пополнение";

  return (
    <Sheet title={title} onClose={onClose}>
      {done ? (
        <div className="stack">
          <p className="lead">
            Зачислено <b>{done.stars} ⭐</b>
            {done.ton > 0 ? <> (≈ {fmt(done.ton)} ◆)</> : null} на единый баланс.
          </p>
          <button className="btn primary wide" onClick={onClose}>
            Вернуться
          </button>
        </div>
      ) : method ? (
        <div className="stack">
          <button className="link-btn" onClick={() => choose(method === "stars" ? "ton" : "stars")}>
            <Glyph name="back" size={16} /> Другой способ
          </button>

          {method === "stars" ? (
            <>
              <p className="lead">
                Оплата звёздами Telegram. 1 ⭐ = 1 ⭐ на балансе, курс к TON: {tonRate} ⭐ = 1 ◆.
                Баланс общий для Stars и TON.
              </p>
              <div className="chips">
                {STAR_AMOUNTS.map((v) => (
                  <button
                    key={v}
                    className={`chip${amount === v ? " on" : ""}`}
                    onClick={() => setAmount(v)}
                    disabled={busy}
                  >
                    ⭐ {v}
                  </button>
                ))}
              </div>
              <p className="muted small">
                К зачислению: <b>{amount} ⭐</b> ≈ {fmt(amount / tonRate)} ◆
              </p>
              <button className="btn primary wide" onClick={payStars} disabled={busy}>
                {busy ? "Создаём счёт…" : `Пополнить на ${amount} ⭐`}
              </button>
              {pendingStars && !tg?.openInvoice && (
                <a className="btn gold wide" href={pendingStars.invoice_link} target="_blank" rel="noreferrer">
                  Открыть счёт в Telegram
                </a>
              )}
            </>
          ) : (
            <>
              <p className="lead">
                Перевод TON на кошелёк проекта. Сумма зачисляется по курсу {tonRate} ⭐ = 1 ◆
                на тот же единый баланс.
              </p>
              <div className="chips">
                {TON_AMOUNTS.map((v) => (
                  <button
                    key={v}
                    className={`chip${amount === v ? " on" : ""}`}
                    onClick={() => setAmount(v)}
                    disabled={busy || Boolean(tonInvoice)}
                  >
                    <Ton size={14} /> {v}
                  </button>
                ))}
              </div>

              {tonInvoice ? (
                <div className="pay-details">
                  <div className="pay-row">
                    <small>Адрес</small>
                    <b className="mono">{tonInvoice.address}</b>
                    <button className="icon-btn" onClick={() => copy(tonInvoice.address, "Адрес")} aria-label="Скопировать адрес">
                      <Glyph name="copy" size={16} />
                    </button>
                  </div>
                  <div className="pay-row">
                    <small>Сумма</small>
                    <b>{fmt(tonInvoice.amount_ton)} ◆</b>
                  </div>
                  <div className="pay-row">
                    <small>Комментарий</small>
                    <b className="mono">{tonInvoice.comment}</b>
                    <button className="icon-btn" onClick={() => copy(tonInvoice.comment, "Комментарий")} aria-label="Скопировать комментарий">
                      <Glyph name="copy" size={16} />
                    </button>
                  </div>
                  <p className="muted small">
                    Без комментария платёж не будет найден. К зачислению: {tonInvoice.amount_stars} ⭐.
                  </p>
                  <button className="btn primary wide" onClick={checkTon} disabled={busy}>
                    {busy ? "Проверяем…" : "Проверить оплату"}
                  </button>
                </div>
              ) : (
                <button
                  className="btn primary wide"
                  onClick={createTonInvoice}
                  disabled={busy || !tonEnabled}
                >
                  {busy ? "Создаём счёт…" : tonEnabled ? `Пополнить на ${amount} ◆` : "TON пока недоступен"}
                </button>
              )}
              {!tonEnabled && (
                <p className="notice">Пополнение TON ещё не настроено на сервере.</p>
              )}
            </>
          )}

          {error && <p className="notice bad">{error}</p>}
          {note && <p className="notice">{note}</p>}
        </div>
      ) : (
        <div className="stack">
          <p className="lead">
            Один баланс для Stars и TON. Пополняйте любым способом — звёзды и TON
            пересчитываются по курсу {tonRate} ⭐ = 1 ◆.
          </p>
          <div className="menu">
            <button className="menu-row" onClick={() => choose("stars")}>
              <span className="menu-ico pay-stars">★</span>
              <span className="menu-text">
                <b>Telegram Stars</b>
                <small>Оплата внутри Telegram, зачисление сразу</small>
              </span>
              <Glyph name="chevron" size={16} />
            </button>
            <button className="menu-row" onClick={() => choose("ton")}>
              <span className="menu-ico pay-crypto">
                <Ton size={22} />
              </span>
              <span className="menu-text">
                <b>TON</b>
                <small>{tonEnabled ? "Перевод на кошелёк проекта" : "Скоро"}</small>
              </span>
              <Glyph name="chevron" size={16} />
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
