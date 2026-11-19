import { CASES } from "./cases";
import { rarityOf, type Rarity } from "../lib/format";

export type LiveDrop = { id: number; user: string; prize: string; value: number; rarity: Rarity };

const NICKS = ["alex_k", "mira", "dimon77", "kate", "tolik", "sasha_b", "nika", "vlad", "yana", "roma"];

/** Демо-лента дропов. Позже заменится данными с бэкенда. */
export function makeLiveDrops(): LiveDrop[] {
  const out: LiveDrop[] = [];
  const pool = CASES.flatMap((c) => c.prizes);
  for (let i = 0; i < 14; i++) {
    const p = pool[(i * 7 + 3) % pool.length];
    out.push({ id: i, user: NICKS[i % NICKS.length], prize: p.name, value: p.value, rarity: rarityOf(p.value) });
  }
  return out;
}
