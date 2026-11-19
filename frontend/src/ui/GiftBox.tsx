import { useId } from "react";

export type BoxPalette = {
  body: [string, string];
  lid: [string, string];
  ribbon: [string, string];
  glow: string;
};

export const PALETTES: Record<string, BoxPalette> = {
  ice: { body: ["#6C9BFF", "#2A4BB8"], lid: ["#8FB4FF", "#3F63D0"], ribbon: ["#FFFFFF", "#CFE0FF"], glow: "#5B8CFF" },
  gold: { body: ["#F6C357", "#B8791A"], lid: ["#FFD87A", "#D79A2B"], ribbon: ["#F0475C", "#B01F36"], glow: "#F2B84B" },
  berry: { body: ["#E8527A", "#8F1D45"], lid: ["#FF7A9C", "#B92B58"], ribbon: ["#FFE7B0", "#F2B84B"], glow: "#E8527A" },
  moss: { body: ["#3FBF8A", "#14674A"], lid: ["#63D8A5", "#1F8A63"], ribbon: ["#FFE7B0", "#F2B84B"], glow: "#3FBF8A" },
  plum: { body: ["#9A6BFF", "#4A2CA8"], lid: ["#B891FF", "#6240C9"], ribbon: ["#FFD87A", "#D79A2B"], glow: "#9A6BFF" },
  ember: { body: ["#FF9A4D", "#B8431B"], lid: ["#FFB77A", "#D95A25"], ribbon: ["#FFF3D6", "#F2D9A0"], glow: "#FF8A3D" },
};

/** Упакованная коробка с бантом. Иллюстрация целиком на SVG, без картинок. */
export default function GiftBox({ palette, className = "" }: { palette: BoxPalette; className?: string }) {
  const id = useId().replace(/:/g, "");
  const g = (n: string) => `url(#${n}${id})`;
  return (
    <svg className={className} viewBox="0 0 160 160" aria-hidden="true">
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.body[0]} />
          <stop offset="1" stopColor={palette.body[1]} />
        </linearGradient>
        <linearGradient id={`l${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.lid[0]} />
          <stop offset="1" stopColor={palette.lid[1]} />
        </linearGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette.ribbon[0]} />
          <stop offset="1" stopColor={palette.ribbon[1]} />
        </linearGradient>
        <radialGradient id={`s${id}`}>
          <stop offset="0" stopColor="#000" stopOpacity=".45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="80" cy="145" rx="54" ry="9" fill={g("s")} />
      {/* корпус */}
      <rect x="34" y="76" width="92" height="66" rx="10" fill={g("b")} />
      <rect x="34" y="76" width="12" height="66" rx="6" fill="#fff" opacity=".14" />
      <rect x="72" y="76" width="16" height="66" fill={g("r")} />
      <rect x="72" y="76" width="4" height="66" fill="#fff" opacity=".35" />
      {/* крышка */}
      <rect x="27" y="56" width="106" height="26" rx="9" fill={g("l")} />
      <rect x="31" y="59" width="98" height="5" rx="2.5" fill="#fff" opacity=".28" />
      <rect x="72" y="56" width="16" height="26" fill={g("r")} />
      <rect x="27" y="76" width="106" height="6" rx="3" fill="#000" opacity=".16" />
      {/* бант */}
      <path d="M80 57C62 58 36 50 40 36 44 22 70 34 80 57z" fill={g("r")} />
      <path d="M80 57C98 58 124 50 120 36 116 22 90 34 80 57z" fill={g("r")} />
      <path d="M80 57C70 50 58 42 46 38" stroke="#000" strokeOpacity=".16" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M80 57C90 50 102 42 114 38" stroke="#000" strokeOpacity=".16" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="80" cy="57" rx="9" ry="8" fill={g("r")} />
      <ellipse cx="77" cy="54" rx="3.5" ry="2.5" fill="#fff" opacity=".5" />
    </svg>
  );
}
