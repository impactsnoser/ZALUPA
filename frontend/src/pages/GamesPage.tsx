import type { ReactNode } from "react";
import { Glyph } from "../ui/Icons";

const ICONS: Record<string, ReactNode> = {
  upgrade: (
    <svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14l7-7 7 7M9 24l7-7 7 7" />
    </svg>
  ),
  rocket: (
    <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor">
      <path d="M16 3c5 3 7.5 8 7 14l-3 3h-8l-3-3c-.5-6 2-11 7-14z" />
      <circle cx="16" cy="12" r="2.6" fill="#0A1F1B" />
      <path d="M9 18l-4 6 6-1zM23 18l4 6-6-1z" opacity=".7" />
      <path d="M13 22h6l-3 7z" opacity=".85" />
    </svg>
  ),
  mines: (
    <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor">
      <path d="M16 3l11 9-11 17L5 12z" opacity=".9" />
      <path d="M5 12h22L16 29z" opacity=".5" />
    </svg>
  ),
  snowfall: (
    <svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3v26M5 9l22 14M5 23 27 9M12 6l4-3 4 3M12 26l4 3 4-3M6 13 5 9l4-1M23 24l4-1-1-4M6 19l-1 4 4 1M23 8l4 1-1 4" />
    </svg>
  ),
  battle: <span aria-hidden="true">⚔️</span>,
};

const GAMES = [
  { id: "Апгрейд", icon: "upgrade", tone: "gold", text: "Обменяй подарок на более дорогой" },
  { id: "Ракетка", icon: "rocket", tone: "red", text: "Забери выигрыш до того, как она улетит" },
  { id: "Мины", icon: "mines", tone: "ice", text: "Открывай клетки и обходи мины" },
  { id: "Ледяная шахта", icon: "snowfall", tone: "ice", text: "Разбивай ледяные блоки и открывай сундуки" },
  { id: "Битва кейсов", icon: "battle", tone: "gold", text: "Открой кейс одновременно с другим игроком" },
];

export default function GamesPage({ onPlay }: { onPlay: (game: string) => void }) {
  return (
    <section className="page">
      <h1 className="page-title">Игры</h1>
      <div className="menu">
        {GAMES.map((g) => (
          <button key={g.id} className="menu-row big" onClick={() => onPlay(g.id)}>
            <span className={`menu-ico tone-${g.tone}`}>{ICONS[g.icon]}</span>
            <span className="menu-text">
              <b>{g.id}</b>
              <small>{g.text}</small>
            </span>
            <Glyph name="chevron" size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
