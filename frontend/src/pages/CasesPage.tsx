import { useMemo, type CSSProperties } from "react";
import { CASES } from "../data/cases";
import { makeLiveDrops } from "../data/mock";
import { fmt } from "../lib/format";
import GiftBox, { PALETTES } from "../ui/GiftBox";
import { Ton } from "../ui/Icons";

function LiveTicker() {
  const drops = useMemo(makeLiveDrops, []);
  const row = (suffix: string) =>
    drops.map((d) => (
      <span key={d.id + suffix} className="drop" data-r={d.rarity}>
        <i />
        <b>{d.user}</b>
        {d.prize}
        <Ton size={12} />
        {fmt(d.value)}
      </span>
    ));
  return (
    <div className="ticker" aria-label="Последние дропы">
      <div className="ticker-track">
        {row("a")}
        <span aria-hidden="true" className="ticker-gap" />
        {row("b")}
      </div>
    </div>
  );
}

export default function CasesPage({ onOpen }: { onOpen: (caseId: string) => void }) {
  return (
    <section className="page">
      <LiveTicker />
      <h1 className="page-title">Кейсы</h1>
      <div className="case-grid">
        {CASES.map((c) => {
          const pal = PALETTES[c.box] ?? PALETTES.ice;
          const max = Math.max(...c.prizes.map((p) => p.value));
          return (
            <button
              key={c.id}
              className="case-card"
              style={{ "--glow": pal.glow } as CSSProperties}
              onClick={() => onOpen(c.id)}
            >
              <span className="case-stage">
                <GiftBox palette={pal} />
              </span>
              <span className="case-name">{c.title}</span>
              <span className="case-meta">
                <span className="price-tag">
                  <Ton size={15} />
                  {fmt(c.price)}
                </span>
                <small>до {Math.floor(max)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}