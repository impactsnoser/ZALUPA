import { useMemo, type CSSProperties } from "react";
import { CASES } from "../data/cases";
import { makeLiveDrops } from "../data/mock";
import { fmt } from "../lib/format";
import { PALETTES } from "../ui/GiftBox";
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
          const featured = [...c.prizes]
            .sort((a, b) => b.value - a.value)
            .slice(0, 3);
          return (
            <button
              key={c.id}
              className="case-card"
              style={{ "--glow": pal.glow } as CSSProperties}
              onClick={() => onOpen(c.id)}
              aria-label={`${c.title}, цена ${fmt(c.price)} TON`}
            >
              <span className="case-name">{c.title}</span>
              <span className="case-highlights" aria-hidden="true">
                {featured.map((prize, index) => (
                  <span className={`case-highlight case-highlight-${index + 1}`} key={prize.id}>
                    <img src={`/prizes/${prize.image}`} alt="" loading="lazy" draggable={false} />
                  </span>
                ))}
              </span>
              <span className="case-meta">
                <span className="price-tag">
                  <Ton size={15} />
                  {fmt(c.price)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
