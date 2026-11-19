import { useEffect, useMemo, useState } from "react";
import { fmt } from "./lib/format";
import { tg } from "./telegram";
import { Glyph, NavIcon, Ton } from "./ui/Icons";
import CasesPage from "./pages/CasesPage";
import GamesPage from "./pages/GamesPage";
import FriendsPage from "./pages/FriendsPage";
import ProfilePage from "./pages/ProfilePage";
import CaseModal from "./modals/CaseModal";
import DepositModal, { type PaymentMethod } from "./modals/DepositModal";
import InfoModal, { type Transaction } from "./modals/InfoModal";
import UpgradeGame from "./games/UpgradeGame";
import RocketGame from "./games/RocketGame";
import MinesGame from "./games/MinesGame";

type Tab = "cases" | "games" | "friends" | "profile";

const REF_LINK = "https://t.me/nexora?start=8472";
const TABS: { id: Tab; label: string }[] = [
  { id: "cases", label: "Кейсы" },
  { id: "games", label: "Игры" },
  { id: "friends", label: "Друзья" },
  { id: "profile", label: "Профиль" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("cases");
  const [depositOpen, setDepositOpen] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [game, setGame] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [balance, setBalance] = useState(10);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [toast, setToast] = useState("");

  const tgUser = tg?.initDataUnsafe?.user;
  const name = tgUser?.first_name ?? tgUser?.username ?? "Игрок";
  const handle = tgUser?.username ? `@${tgUser.username}` : "в браузере";
  const initial = name.slice(0, 1).toUpperCase();
  const played = transactions.filter((t) => t.amount < 0).length;
  const level = 1 + Math.floor(played / 5);
  const levelProgress = ((played % 5) / 5) * 100;

  const link = useMemo(() => REF_LINK, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const log = (label: string, amount: number) =>
    setTransactions((cur) => [{ id: Date.now() + Math.random(), label, amount, date: "Только что" }, ...cur]);

  function spend(amount: number, label: string) {
    setBalance((b) => Math.max(0, b - amount));
    log(label, -amount);
  }
  function win(amount: number, label: string) {
    setBalance((b) => b + amount);
    log(label, amount);
  }
  function deposit(amount: number, method: PaymentMethod) {
    setBalance((b) => b + amount);
    log(method === "nft" ? "NFT-подарок" : method === "stars" ? "Telegram Stars" : "Пополнение TON", amount);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setToast("Ссылка скопирована");
    } catch {
      setToast(`Ссылка: ${link.replace("https://", "")}`);
    }
  }
  async function invite() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "NEXORA", text: "Заходи в NEXORA", url: link });
      } catch {
        /* отменено */
      }
      return;
    }
    copyLink();
  }

  function go(next: Tab) {
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
    tg?.HapticFeedback?.impactOccurred("light");
  }

  const closeGame = () => setGame(null);
  const gameProps = { balance, onSpend: spend, onWin: win, onDeposit: () => (setGame(null), setDepositOpen(true)) };

  return (
    <div className="app">
      <header className="topbar">
        <button className="who" onClick={() => go("profile")} aria-label="Профиль">
          <span className="avatar">{initial}</span>
          <span className="who-text">
            <b>{name}</b>
            <span className="lvl">
              <small>Ур. {level}</small>
              <i>
                <u style={{ width: `${levelProgress}%` }} />
              </i>
            </span>
          </span>
        </button>
        <div className="wallet">
          <Ton size={18} />
          <b>{fmt(balance)}</b>
          <button className="wallet-plus" onClick={() => setDepositOpen(true)} aria-label="Пополнить баланс">
            <Glyph name="plus" size={16} />
          </button>
        </div>
      </header>

      <main>
        {tab === "cases" && <CasesPage onOpen={setCaseId} />}
        {tab === "games" && <GamesPage onPlay={setGame} />}
        {tab === "friends" && <FriendsPage link={link} onCopy={copyLink} onInvite={invite} />}
        {tab === "profile" && (
          <ProfilePage
            name={name}
            handle={handle}
            initial={initial}
            balance={balance}
            games={played}
            onDeposit={() => setDepositOpen(true)}
            onMenu={(l) => (l === "Друзья" ? go("friends") : setInfo(l))}
          />
        )}
      </main>

      <nav className="dock" aria-label="Разделы">
        {TABS.map((t) => (
          <button key={t.id} className="dock-item" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            <NavIcon name={t.id} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {game && (
        <div className="play">
          <header className="play-head">
            <button className="icon-btn" onClick={closeGame} aria-label="Назад">
              <Glyph name="back" />
            </button>
            <h2>{game}</h2>
            <div className="wallet small">
              <Ton size={15} />
              <b>{fmt(balance)}</b>
            </div>
          </header>
          <div className="play-body">
            {game === "Апгрейд" && <UpgradeGame />}
            {game === "Ракетка" && <RocketGame {...gameProps} />}
            {game === "Мины" && <MinesGame {...gameProps} />}
          </div>
        </div>
      )}

      {caseId && (
        <CaseModal
          caseId={caseId}
          balance={balance}
          onClose={() => setCaseId(null)}
          onDeposit={() => (setCaseId(null), setDepositOpen(true))}
          onSpend={spend}
          onWin={win}
        />
      )}
      {depositOpen && <DepositModal onClose={() => setDepositOpen(false)} onComplete={deposit} />}
      {info && <InfoModal title={info} onClose={() => setInfo(null)} transactions={transactions} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
