const STANDARD_GIFT_ART: Record<string, string> = {
  "кольцо": "classic-ring.png",
  "кубок": "classic-cup.png",
  "ракета": "classic-rocket.png",
  "букет": "classic-bouquet.png",
  "торт": "classic-cake.png",
  "роза": "classic-rose.png",
  "подарок": "classic-gift.png",
  "сердце": "classic-heart.png",
  "мишка": "classic-bear.png",
  "алмаз": "classic-diamond.png",
  "шампанское": "classic-champagne.png",
};

export function giftArtworkPath(name: string): string | null {
  const file = STANDARD_GIFT_ART[name.trim().toLocaleLowerCase("ru-RU")];
  return file ? `/prizes/${file}` : null;
}
