import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type SellResult, type Wallet } from "./api";
import { fmt } from "./lib/format";
import { getTelegramId, tg } from "./telegram";
import { Glyph, NavIcon, Ton } from "./ui/Icons";
import CasesPage from "./pages/CasesPage";
import GamesPage from "./pages/GamesPage";
import FriendsPage from "./pages/FriendsPage";
import ProfilePage from "./pages/ProfilePage";
import CaseModal from "./modals/CaseModal";
import DepositModal from "./modals/DepositModal";
import AdminModal from "./modals/AdminModal";
import InfoModal, { type Transaction } from "./modals/InfoModal";
import UpgradeGame from "./games/UpgradeGame";
import RocketGame from "./games/RocketGame";
import MinesGame from "./games/MinesGame";
import SnowfallGame from "./games/SnowfallGame";

type Tab = "cases" | "games" | "friends" | "profile";

const REF_LINK = "https://t.me/nexora?start=8472";
const TABS: { id: Tab; label: string }[] = [
  { id: "cases", label: "Кейсы" },
  { id: "games", label: "Игры" },
  { id: "friends", label: "Друзья" },
  { id: "profile", label: "Профиль" },
];

const KIND_LABEL: Record<string, string> = {
  welcome: "Приветственный баланс",
  bet: "Ставка",
  win: "Выигрыш",
  deposit_stars: "Пополнение Stars",
  deposit_ton: "Пополнение TON",
};

function txDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Недавно";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [tab, setTab] = useState<Tab>("cases");
  const [depositOpen, setDepositOpen] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [game, setGame] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  // Баланс хранится на сервере в звёздах, в интерфейсе показываем TON
  // по курсу starsPerTon. Это один и тот же баланс, а не две валюты.
  const [balanceStars, setBalanceStars] = useState(0);
  const [balance, setBalance] = useState(0);
  const [starsPerTon, setStarsPerTon] = useState(100);
  const [tonEnabled, setTonEnabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [toast, setToast] = useState("");
  const [musicPlaying, setMusicPlaying] = useState(false);

  const tgUser = tg?.initDataUnsafe?.user;
  const name = tgUser?.first_name ?? tgUser?.username ?? "Игрок";
  const handle = tgUser?.username ? `@${tgUser.username}` : "в браузере";
  const initial = name.slice(0, 1).toUpperCase();
  const played = transactions.filter((t) => t.amount < 0).length;
  const level = 1 + Math.floor(played / 5);
  const levelProgress = ((played % 5) / 5) * 100;

  const link = useMemo(() => REF_LINK, []);

  const applyWallet = useCallback((wallet: Wallet) => {
    setBalanceStars(wallet.balance_stars);
    setBalance(wallet.balance_ton);
    setStarsPerTon(wallet.stars_per_ton);
    setTonEnabled(wallet.ton_deposit_enabled);
    setIsAdmin(Boolean(wallet.is_admin));
    // История тоже живёт на сервере: после перезагрузки она не пропадёт.
    setTransactions(
      wallet.transactions.map((t) => ({
        id: t.id,
        label: t.label ?? KIND_LABEL[t.kind] ?? "Операция",
        amount: t.amount_ton,
        date: txDate(t.created_at),
      })),
    );
  }, []);

  const refreshWallet = useCallback(async () => {
    const telegramId = getTelegramId();
    try {
      const wallet = await api.getWallet(telegramId);
      applyWallet(wallet);
    } catch {
      // Нового игрока ещё нет в базе — регистрируем и выдаём стартовый подарок.
      try {
        await api.register(telegramId, tgUser?.username ?? null);
        const wallet = await api.getWallet(telegramId);
        applyWallet(wallet);
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Не удалось загрузить баланс");
      }
    }
  }, [applyWallet, tgUser?.username]);

  const handleSold = useCallback(
    (result: SellResult) => {
      // Мгновенно показываем новый баланс, не дожидаясь ответа кошелька.
      setBalanceStars(result.balance_stars);
      setBalance(result.balance_ton);
      setToast(`+${result.sold_stars} ⭐ за проданный предмет`);
      tg?.HapticFeedback?.notificationOccurred("success");
      // Историю операций подтягиваем следом.
      void refreshWallet();
    },
    [refreshWallet],
  );

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const log = (label: string, amount: number) =>
    setTransactions((cur) => [{ id: Date.now() + Math.random(), label, amount, date: "Только что" }, ...cur]);

  function spend(amount: number, label: string) {
    const amountStars = Math.max(1, Math.round(amount * starsPerTon));
    setBalance((b) => Math.max(0, b - amount));
    setBalanceStars((s) => Math.max(0, s - amountStars));
    log(label, -amount);
    api
      .spend(getTelegramId(), amountStars, label)
      .then((res) => {
        setBalanceStars(res.balance_stars);
        setBalance(res.balance_ton);
      })
      .catch((err) => {
        setToast(err instanceof Error ? err.message : "Ставка не принята");
        void refreshWallet();
      });
  }

  function win(amount: number, label: string) {
    const amountStars = Math.max(1, Math.round(amount * starsPerTon));
    setBalance((b) => b + amount);
    setBalanceStars((s) => s + amountStars);
    log(label, amount);
    api
      .credit(getTelegramId(), amountStars, label)
      .then((res) => {
        setBalanceStars(res.balance_stars);
        setBalance(res.balance_ton);
      })
      .catch(() => void refreshWallet());
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
  const gameProps = { balance, onSpend: spend, onWin: win, onDeposit: () => setDepositOpen(true) };

  function toggleSecretMusic() {
    const audio = document.getElementById("secret-track") as HTMLAudioElement | null;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => {
        setMusicPlaying(true);
        setToast("Голда на Голду 🎵");
      }).catch(() => setToast("Не удалось включить музыку"));
    } else {
      audio.pause();
      setMusicPlaying(false);
      setToast("Музыка на паузе");
    }
    tg?.HapticFeedback?.impactOccurred("light");
  }

  return (
    <div className="app">
      <div className="edge-glow" aria-hidden="true" />
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
        <div className="wallet" title={`${balanceStars} ⭐`}>
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
            stars={balanceStars}
            telegramId={getTelegramId()}
            games={played}
            isAdmin={isAdmin}
            onDeposit={() => setDepositOpen(true)}
            onAdmin={() => setAdminOpen(true)}
            onSold={handleSold}
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
        <button
          className={`dock-music${musicPlaying ? " playing" : ""}`}
          onClick={toggleSecretMusic}
          aria-label={musicPlaying ? "Поставить песню на паузу" : "Включить секретную песню"}
          aria-pressed={musicPlaying}
          title="🎵"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </button>
      </nav>

      <audio id="secret-track" src="/golda-na-goldu.mp3" preload="none" onEnded={() => setMusicPlaying(false)} />

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
            {game === "Ледяная шахта" && (
              <SnowfallGame
                balance={balance}
                starsPerTon={starsPerTon}
                onBalance={(stars, ton) => { setBalanceStars(stars); setBalance(ton); }}
                onChanged={refreshWallet}
                onDeposit={() => setDepositOpen(true)}
              />
            )}
          </div>
        </div>
      )}

      {caseId && (
        <CaseModal
          caseId={caseId}
          telegramId={getTelegramId()}
          balance={balance}
          onClose={() => setCaseId(null)}
          onDeposit={() => (setCaseId(null), setDepositOpen(true))}
          onCredited={refreshWallet}
        />
      )}
      {depositOpen && (
        <DepositModal
          telegramId={getTelegramId()}
          balanceStars={balanceStars}
          starsPerTon={starsPerTon}
          tonEnabled={tonEnabled}
          onClose={() => setDepositOpen(false)}
          onCredited={applyWallet}
        />
      )}
      {adminOpen && (
        <AdminModal
          telegramId={getTelegramId()}
          onClose={() => setAdminOpen(false)}
          onChanged={refreshWallet}
        />
      )}
      {info && <InfoModal title={info} onClose={() => setInfo(null)} transactions={transactions} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
