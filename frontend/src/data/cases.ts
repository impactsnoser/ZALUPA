/**
 * Кейсы и призы.
 *
 * Наполнение и веса лежат в cases_data.ts (генерируется из таблицы).
 * Здесь только производные функции: шансы, RTP, демо-розыгрыш.
 *
 * weight — вес выпадения из 10 000 (1 = 0,01 %). Сумма весов в каждом кейсе
 * ровно 10 000. Шанс в интерфейсе = weight / 10 000, то есть игрок видит
 * ровно тот шанс, который используется в розыгрыше.
 */

import { CASES, type CaseDef, type CasePrize } from "./cases_data";

export type { CaseDef, CasePrize };
export type Prize = CasePrize;

export { CASES };

export const getCase = (id: string) => CASES.find((c) => c.id === id);

export const TOTAL_WEIGHT = 10_000;

export const chanceOf = (p: CasePrize) => (p.weight / TOTAL_WEIGHT) * 100;

/** Возврат игроку (RTP), % */
export const rtpOf = (c: CaseDef) =>
  (c.prizes.reduce((s, p) => s + p.value * p.weight, 0) / TOTAL_WEIGHT / c.price) * 100;

/** Шанс получить приз не меньше цены кейса, % */
export const paybackChance = (c: CaseDef) =>
  c.prizes.filter((p) => p.value >= c.price).reduce((s, p) => s + p.weight, 0) /
  (TOTAL_WEIGHT / 100);

/** Равномерное целое [0, max) без смещения */
function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

/**
 * ДЕМО-розыгрыш на клиенте. Реальный розыгрыш всегда считает сервер
 * (secrets.randbelow) — клиентский результат нельзя подделать только на вид.
 */
export function drawPrize(c: CaseDef): CasePrize {
  let roll = randomInt(TOTAL_WEIGHT);
  for (const p of c.prizes) {
    if (roll < p.weight) return p;
    roll -= p.weight;
  }
  return c.prizes[c.prizes.length - 1];
}

/** Для консоли: проверка, что сумма весов = 10 000 */
export function checkCases(): void {
  for (const c of CASES) {
    const sum = c.prizes.reduce((s, p) => s + p.weight, 0);
    if (sum !== TOTAL_WEIGHT)
      console.warn(`Кейс «${c.title}»: сумма весов ${sum}, нужно ${TOTAL_WEIGHT}`);
  }
}