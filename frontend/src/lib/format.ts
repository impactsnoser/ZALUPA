export const fmt = (n: number) => String(Number(n.toFixed(2))).replace(".", ",");
export const fmtChance = (c: number) =>
  (c < 0.1 ? c.toFixed(2) : c < 10 ? c.toFixed(1) : c.toFixed(0)).replace(".", ",");

export type Rarity = "common" | "blue" | "purple" | "pink" | "red" | "gold";

/** Редкость по стоимости приза */
export function rarityOf(value: number): Rarity {
  if (value >= 100) return "gold";
  if (value >= 40) return "red";
  if (value >= 25) return "pink";
  if (value >= 15) return "purple";
  if (value >= 5) return "blue";
  return "common";
}
