/**
 * Кейсы и призы.
 *
 * weight — вес выпадения из 10 000 (1 = 0,01 %). Сумма весов в каждом кейсе
 * должна быть ровно 10 000 (проверяется функцией checkCases()).
 * Шанс в интерфейсе = weight / 10 000, то есть показывается ровно тот шанс, что в розыгрыше.
 *
 * Картинки: public/prizes/<image>. Если файла нет, показывается emoji.
 */

export type Prize = {
  id: string;
  name: string;
  /** Стоимость приза в TON (◆) */
  value: number;
  /** Имя файла в public/prizes/ */
  image: string;
  emoji: string;
  weight: number;
};

export type CaseDef = {
  id: string;
  title: string;
  price: number;
  /** Ключ палитры коробки из ui/GiftBox */
  box: string;
  prizes: Prize[];
};

const TOTAL_WEIGHT = 10_000;

// ===== Кейс за 5 =====
const snowPrizes: Prize[] = [
  { id: "bag", name: "Оранжевая сумка", value: 142.76, image: "bag.png", emoji: "👜", weight: 1 },
  { id: "ring", name: "Золотое кольцо", value: 48.79, image: "ring.png", emoji: "💍", weight: 4 },
  { id: "helmet", name: "Розовый мотошлем", value: 43.1, image: "helmet.png", emoji: "🪖", weight: 6 },
  { id: "bear", name: "Плюшевый мишка", value: 40.49, image: "bear.png", emoji: "🧸", weight: 8 },
  { id: "potion", name: "Любовное зелье", value: 18.37, image: "potion.png", emoji: "🧪", weight: 30 },
  { id: "vinyl", name: "Проигрыватель", value: 15.28, image: "vinyl.png", emoji: "📀", weight: 50 },
  { id: "candle", name: "Свеча-сердце", value: 13.77, image: "candle.png", emoji: "🕯️", weight: 70 },
  { id: "cocoa", name: "Какао", value: 6, image: "cocoa.png", emoji: "☕", weight: 250 },
  { id: "snake", name: "Новогодняя змея", value: 5.39, image: "snake.png", emoji: "🐍", weight: 250 },
  { id: "giftbox", name: "Подарочная коробка", value: 5.25, image: "giftbox.png", emoji: "🎁", weight: 300 },
  { id: "numbers", name: "Цифры 2025", value: 5.23, image: "numbers.png", emoji: "🔢", weight: 300 },
  { id: "stocking", name: "Новогодний носок", value: 5.18, image: "stocking.png", emoji: "🧦", weight: 2900 },
  { id: "ton-1", name: "1 TON", value: 1, image: "ton.png", emoji: "💎", weight: 5831 },
];

// ===== Кейс за 8 =====
const goldPrizes: Prize[] = [
  { id: "hand", name: "Золотой жест", value: 131.27, image: "hand.png", emoji: "🖖", weight: 2 },
  { id: "watch", name: "Золотые часы", value: 68.68, image: "watch.png", emoji: "⌚", weight: 5 },
  { id: "bear", name: "Плюшевый мишка", value: 40.49, image: "bear.png", emoji: "🧸", weight: 10 },
  { id: "rose", name: "Роза под колпаком", value: 32.13, image: "rose.png", emoji: "🌹", weight: 15 },
  { id: "locket", name: "Золотой замочек", value: 26.61, image: "locket.png", emoji: "💛", weight: 25 },
  { id: "heels", name: "Розовые туфли", value: 25.41, image: "heels.png", emoji: "👠", weight: 30 },
  { id: "cigar", name: "Сигара", value: 18.21, image: "cigar.png", emoji: "🚬", weight: 50 },
  { id: "tophat", name: "Цилиндр", value: 11.49, image: "tophat.png", emoji: "🎩", weight: 100 },
  { id: "gingerbread", name: "Пряничное сердце", value: 6.57, image: "gingerbread.png", emoji: "🍪", weight: 700 },
  { id: "clover", name: "Клевер", value: 6.43, image: "clover.png", emoji: "🍀", weight: 800 },
  { id: "cocoa", name: "Какао", value: 6, image: "cocoa.png", emoji: "☕", weight: 900 },
  { id: "torch", name: "Факел", value: 5.22, image: "torch.png", emoji: "🔦", weight: 1000 },
  { id: "candycane", name: "Леденец", value: 5.15, image: "candycane.png", emoji: "🍭", weight: 1000 },
  { id: "ton-3", name: "3 TON", value: 3, image: "ton.png", emoji: "💎", weight: 2000 },
  { id: "ton-2.5", name: "2,5 TON", value: 2.5, image: "ton.png", emoji: "💎", weight: 1500 },
  { id: "ton-2", name: "2 TON", value: 2, image: "ton.png", emoji: "💎", weight: 1863 },
];

export const CASES: CaseDef[] = [
  { id: "snow", title: "Снежный кейс", price: 5, box: "ice", prizes: snowPrizes },
  { id: "gold", title: "Золотой кейс", price: 8, box: "gold", prizes: goldPrizes },
];

/** Кейсы без наполнения: показываются как «Скоро» */
export const SOON_CASES: { id: string; title: string; price: number; box: string }[] = [
  { id: "shawarma", title: "Шаурма из ларька", price: 15, box: "ember" },
  { id: "cat", title: "Кот в мешке", price: 20, box: "plum" },
  { id: "dumplings", title: "Пельмени судьбы", price: 25, box: "moss" },
  { id: "neighbor", title: "Сосед сверху", price: 30, box: "berry" },
  { id: "build", title: "Стройка века", price: 35, box: "ice" },
  { id: "santa", title: "Дед Мороз на мопеде", price: 50, box: "gold" },
];

export const getCase = (id: string) => CASES.find((c) => c.id === id);

export const chanceOf = (p: Prize) => (p.weight / TOTAL_WEIGHT) * 100;

/** Возврат игроку (RTP), % */
export const rtpOf = (c: CaseDef) =>
  (c.prizes.reduce((s, p) => s + p.value * p.weight, 0) / TOTAL_WEIGHT / c.price) * 100;

/** Шанс получить приз не меньше цены кейса, % */
export const paybackChance = (c: CaseDef) =>
  c.prizes.filter((p) => p.value >= c.price).reduce((s, p) => s + p.weight, 0) / (TOTAL_WEIGHT / 100);

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
 * ДЕМО-розыгрыш на клиенте. Для реальных денег розыгрыш обязан идти на бэкенде
 * (secrets.randbelow), иначе результат можно подделать.
 */
export function drawPrize(c: CaseDef): Prize {
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
    if (sum !== TOTAL_WEIGHT) console.warn(`Кейс «${c.title}»: сумма весов ${sum}, нужно ${TOTAL_WEIGHT}`);
  }
}
