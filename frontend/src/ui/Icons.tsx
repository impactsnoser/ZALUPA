import type { ReactNode } from "react";
import { useId } from "react";

/** Алмаз TON */
export function Ton({ size = 16, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C9F3FF" />
          <stop offset="0.55" stopColor="#6FD0F5" />
          <stop offset="1" stopColor="#2E8FD0" />
        </linearGradient>
      </defs>
      <path d="M12 2 21.5 9 12 22 2.5 9z" fill={`url(#t${id})`} />
      <path d="M12 2 8.4 9H15.6z" fill="#fff" opacity=".55" />
      <path d="M2.5 9H21.5L12 22z" fill="#1B6FB3" opacity=".28" />
    </svg>
  );
}

const nav: Record<string, ReactNode> = {
  cases: (
    <>
      <path d="M4 10.5h16V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V9H3z" />
      <rect x="10.8" y="5" width="2.4" height="16" fill="#000" opacity=".28" />
    </>
  ),
  games: (
    <>
      <path d="M7.5 7h9A5.5 5.5 0 0 1 22 12.6V15a3 3 0 0 1-5.2 2L15.5 15.5h-7L7.2 17A3 3 0 0 1 2 15v-2.4A5.5 5.5 0 0 1 7.5 7z" />
      <path d="M7.5 10.2v3.6M5.7 12h3.6" stroke="#000" strokeOpacity=".4" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16.5" cy="10.8" r="1.1" fill="#000" opacity=".4" />
      <circle cx="18.6" cy="13" r="1.1" fill="#000" opacity=".4" />
    </>
  ),
  friends: (
    <>
      <circle cx="9" cy="8" r="3.6" />
      <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0z" />
      <circle cx="17.4" cy="9" r="2.7" opacity=".7" />
      <path d="M16.2 14.2a5.4 5.4 0 0 1 5.3 6.3h-4.2a8 8 0 0 0-1.1-6.3z" opacity=".7" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4.2" />
      <path d="M4 21a8 8 0 0 1 16 0z" />
    </>
  ),
};

export function NavIcon({ name }: { name: keyof typeof nav }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {nav[name]}
    </svg>
  );
}

export function Glyph({ name, size = 18 }: { name: "plus" | "close" | "back" | "copy" | "check" | "chevron"; size?: number }) {
  const p = {
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    back: <path d="m15 5-7 7 7 7" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2.5" />
        <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4H6.5A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
      </>
    ),
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}
