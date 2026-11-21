/**
 * СГЕНЕРИРОВАНО из таблицы кейсов.
 *
 * Призы отсортированы по цене: rarity 1 — самый дешёвый и частый,
 * последний rarity — самый дорогой и редкий. Веса подобраны так, что
 * возврат игроку (RTP) каждого кейса ≈ 92%, сумма весов = 10 000
 * (1 вес = 0,01% шанса). Эти же данные лежат в backend/cases_data.py —
 * менять нужно синхронно, иначе клиент и сервер разойдутся.
 */

export type CasePrize = {
  id: string;
  name: string;
  /** Стоимость приза в TON */
  value: number;
  /** Файл в public/prizes/ */
  image: string;
  /** Вес выпадения из 10 000 */
  weight: number;
  /** 1 — самый частый, чем больше, тем реже */
  rarity: number;
};

export type CaseDef = {
  id: string;
  title: string;
  price: number;
  /** Ключ палитры коробки из ui/GiftBox */
  box: string;
  prizes: CasePrize[];
};

const RAW: { id: string; title: string; price: number; box: string;
  prizes: [string, string, number, string, number, number][] }[] = [
  {
    id: "surprise", title: "Сюрприз", price: 9, box: "ice",
    prizes: [
      ["vicecream", "Vice Cream", 4.69, "vicecream.png", 198, 1],
      ["poolfloat", "Pool Float", 4.73, "poolfloat.png", 196, 2],
      ["chillflame", "Chill Flame", 4.77, "chillflame.png", 194, 3],
      ["lunarsnake", "Lunar Snake", 4.77, "lunarsnake.png", 194, 4],
      ["instantramen", "Instant Ramen", 4.78, "instantramen.png", 194, 5],
      ["lolpop", "Lol Pop", 4.78, "lolpop.png", 194, 6],
      ["icecream", "Ice Cream", 4.79, "icecream.png", 193, 7],
      ["bigyear", "Big Year", 4.82, "bigyear.png", 192, 8],
      ["snakebox", "Snake Box", 4.82, "snakebox.png", 192, 9],
      ["whipcupcake", "Whip Cupcake", 4.83, "whipcupcake.png", 192, 10],
      ["candycane", "Candy Cane", 4.84, "candycane.png", 191, 11],
      ["xmasstocking", "Xmas Stocking", 4.85, "xmasstocking.png", 191, 12],
      ["easteregg", "Easter Egg", 4.9, "easteregg.png", 189, 13],
      ["miragelamp", "Mirage Lamp", 4.9, "miragelamp.png", 189, 14],
      ["petsnake", "Pet Snake", 4.9, "petsnake.png", 189, 15],
      ["jesterhat", "Jester Hat", 5.0, "jesterhat.png", 185, 16],
      ["happybrownie", "Happy Brownie", 5.09, "happybrownie.png", 182, 17],
      ["holidaydrink", "Holiday Drink", 5.14, "holidaydrink.png", 180, 18],
      ["freshsocks", "Fresh Socks", 5.19, "freshsocks.png", 178, 19],
      ["starnotepad", "Star Notepad", 5.2, "starnotepad.png", 178, 20],
      ["victorymedal", "Victory Medal", 5.2, "victorymedal.png", 178, 21],
      ["hypnolollipop", "Hypno Lollipop", 5.24, "hypnolollipop.png", 177, 22],
      ["tamagadget", "Tama Gadget", 5.24, "tamagadget.png", 177, 23],
      ["moodpack", "Mood Pack", 5.25, "moodpack.png", 176, 24],
      ["jackinthebox", "Jack-in-the-Box", 5.29, "jackinthebox.png", 175, 25],
      ["timelessbook", "Timeless Book", 5.47, "timelessbook.png", 169, 26],
      ["stellarrocket", "Stellar Rocket", 5.5, "stellarrocket.png", 168, 27],
      ["spicedwine", "Spiced Wine", 5.55, "spicedwine.png", 167, 28],
      ["moneypot", "Money Pot", 5.58, "moneypot.png", 166, 29],
      ["gingercookie", "Ginger Cookie", 5.6, "gingercookie.png", 165, 30],
      ["bdaycandle", "B-Day Candle", 5.61, "bdaycandle.png", 165, 31],
      ["winterwreath", "Winter Wreath", 5.64, "winterwreath.png", 164, 32],
      ["prettyposy", "Pretty Posy", 5.69, "prettyposy.png", 163, 33],
      ["moussecake", "Mousse Cake", 5.7, "moussecake.png", 162, 34],
      ["partysparkler", "Party Sparkler", 5.7, "partysparkler.png", 162, 35],
      ["hexpot", "Hex Pot", 5.71, "hexpot.png", 162, 36],
      ["cloverpin", "Clover Pin", 5.81, "cloverpin.png", 159, 37],
      ["homemadecake", "Homemade Cake", 5.89, "homemadecake.png", 157, 38],
      ["deskcalendar", "Desk Calendar", 6.02, "deskcalendar.png", 154, 39],
      ["cookieheart", "Cookie Heart", 6.1, "cookieheart.png", 152, 40],
      ["restlessjar", "Restless Jar", 6.1, "restlessjar.png", 152, 41],
      ["bowtie", "Bow Tie", 6.3, "bowtie.png", 147, 42],
      ["springbasket", "Spring Basket", 6.34, "springbasket.png", 146, 43],
      ["witchhat", "Witch Hat", 6.34, "witchhat.png", 146, 44],
      ["swagbag", "Swag Bag", 6.52, "swagbag.png", 142, 45],
      ["lushbouquet", "Lush Bouquet", 6.53, "lushbouquet.png", 142, 46],
      ["libertyfigure", "Liberty Figure", 6.6, "libertyfigure.png", 140, 47],
      ["snoopdogg", "Snoop Dogg", 6.62, "snoopdogg.png", 140, 48],
      ["faithamulet", "Faith Amulet", 6.9, "faithamulet.png", 134, 49],
      ["lightsword", "Light Sword", 6.93, "lightsword.png", 134, 50],
      ["eternalcandle", "Eternal Candle", 6.99, "eternalcandle.png", 133, 51],
      ["inputkey", "Input Key", 7.14, "inputkey.png", 130, 52],
      ["moonpendant", "Moon Pendant", 7.3, "moonpendant.png", 127, 53],
      ["spyagaric", "Spy Agaric", 7.46, "spyagaric.png", 124, 54],
      ["surgeboard", "Surge Board", 7.53, "surgeboard.png", 123, 55],
      ["snowglobe", "Snow Globe", 8.1, "snowglobe.png", 115, 56],
      ["santahat", "Santa Hat", 8.4, "santahat.png", 110, 57],
      ["finepen", "Fine Pen", 8.82, "finepen.png", 105, 58],
      ["jollychimp", "Jolly Chimp", 8.86, "jollychimp.png", 105, 59],
      ["joyfulbundle", "Joyful Bundle", 9.23, "joyfulbundle.png", 101, 60],
      ["evileye", "Evil Eye", 9.31, "evileye.png", 100, 61],
      ["snowmittens", "Snow Mittens", 9.49, "snowmittens.png", 98, 62],
      ["bunnymuffin", "Bunny Muffin", 9.59, "bunnymuffin.png", 97, 63],
    ],
  },
  {
    id: "collect", title: "Коллекционный", price: 33, box: "ember",
    prizes: [
      ["jellybunny", "Jelly Bunny", 10.0, "jellybunny.png", 310, 1],
      ["berrybox", "Berry Box", 10.3, "berrybox.png", 306, 2],
      ["sleighbell", "Sleigh Bell", 10.5, "sleighbell.png", 305, 3],
      ["tophat", "Top Hat", 10.7, "tophat.png", 305, 4],
      ["hangingstar", "Hanging Star", 10.8, "hangingstar.png", 304, 5],
      ["jinglebells", "Jingle Bells", 10.9, "jinglebells.png", 304, 6],
      ["mythmask", "Myth Mask", 10.9, "mythmask.png", 304, 7],
      ["sakuraflower", "Sakura Flower", 11.9, "sakuraflower.png", 300, 8],
      ["lovecandle", "Love Candle", 12.5, "lovecandle.png", 297, 9],
      ["madpumpkin", "Mad Pumpkin", 12.9, "madpumpkin.png", 296, 10],
      ["skullflower", "Skull Flower", 13.2, "skullflower.png", 295, 11],
      ["flyingbroom", "Flying Broom", 13.7, "flyingbroom.png", 293, 12],
      ["valentinebox", "Valentine Box", 14.3, "valentinebox.png", 291, 13],
      ["recordplayer", "Record Player", 14.4, "recordplayer.png", 291, 14],
      ["crystalball", "Crystal Ball", 14.7, "crystalball.png", 290, 15],
      ["luckylocket", "Lucky Locket", 14.9, "luckylocket.png", 290, 16],
      ["snoopcigar", "Snoop Cigar", 17.3, "snoopcigar.png", 283, 17],
      ["lovepotion", "Love Potion", 17.4, "lovepotion.png", 283, 18],
      ["ionicdryer", "Ionic Dryer", 17.6, "ionicdryer.png", 282, 19],
      ["ufcstrike", "UFC Strike", 19.3, "ufcstrike.png", 278, 20],
      ["trappedheart", "Trapped Heart", 19.9, "trappedheart.png", 277, 21],
      ["skystilettos", "Sky Stilettos", 24.2, "skystilettos.png", 269, 22],
      ["cupidcharm", "Cupid Charm", 25.5, "cupidcharm.png", 267, 23],
      ["blingbinky", "Bling Binky", 28.9, "blingbinky.png", 262, 24],
      ["khabibspapakha", "Khabib's Papakha", 30.0, "khabibspapakha.png", 260, 25],
      ["eternalrose", "Eternal Rose", 30.8, "eternalrose.png", 259, 26],
      ["rarebird", "Rare Bird", 31.0, "rarebird.png", 259, 27],
      ["electricskull", "Electric Skull", 32.3, "electricskull.png", 258, 28],
      ["genielamp", "Genie Lamp", 37.8, "genielamp.png", 251, 29],
      ["signetring", "Signet Ring", 38.6, "signetring.png", 251, 30],
      ["diamondring", "Diamond Ring", 39.0, "diamondring.png", 250, 31],
      ["toybear", "Toy Bear", 39.8, "toybear.png", 249, 32],
      ["voodoodoll", "Voodoo Doll", 42.8, "voodoodoll.png", 247, 33],
      ["nekohelmet", "Neko Helmet", 43.2, "nekohelmet.png", 246, 34],
      ["vintagecigar", "Vintage Cigar", 45.4, "vintagecigar.png", 245, 35],
      ["bondedring", "Bonded Ring", 47.7, "bondedring.png", 243, 36],
    ],
  },
  {
    id: "exclusive", title: "Эксклюзив", price: 140, box: "plum",
    prizes: [
      ["sharptongue", "Sharp Tongue", 51.4, "sharptongue.png", 753, 1],
      ["kissedfrog", "Kissed Frog", 55.6, "kissedfrog.png", 732, 2],
      ["swisswatch", "Swiss Watch", 65.6, "swisswatch.png", 693, 3],
      ["magicpotion", "Magic Potion", 67.4, "magicpotion.png", 687, 4],
      ["gemsignet", "Gem Signet", 72.4, "gemsignet.png", 670, 5],
      ["minioscar", "Mini Oscar", 75.0, "minioscar.png", 663, 6],
      ["lowrider", "Low Rider", 79.5, "lowrider.png", 650, 7],
      ["artisanbrick", "Artisan Brick", 80.5, "artisanbrick.png", 647, 8],
      ["iongem", "Ion Gem", 81.9, "iongem.png", 643, 9],
      ["perfumebottle", "Perfume Bottle", 90.8, "perfumebottle.png", 622, 10],
      ["westsidesign", "Westside Sign", 126.4, "westsidesign.png", 556, 11],
      ["mightyarm", "Mighty Arm", 128.5, "mightyarm.png", 553, 12],
      ["nailbracelet", "Nail Bracelet", 140.7, "nailbracelet.png", 537, 13],
      ["astralshard", "Astral Shard", 142.8, "astralshard.png", 534, 14],
      ["lootbag", "Loot Bag", 143.5, "lootbag.png", 533, 15],
      ["durovsglasses", "Durov's Glasses", 148.6, "durovsglasses.png", 527, 16],
    ],
  },
  {
    id: "premium", title: "Премиальный", price: 490, box: "berry",
    prizes: [
      ["heroichelmet", "Heroic Helmet", 186.9, "heroichelmet.png", 2361, 1],
      ["preciouspeach", "Precious Peach", 275.4, "preciouspeach.png", 2084, 2],
      ["scaredcat", "Scared Cat", 289.7, "scaredcat.png", 2051, 3],
      ["durovscap", "Durov's Cap", 428.4, "durovscap.png", 1809, 4],
      ["resistancedog", "Resistance Dog", 524.3, "resistancedog.png", 1695, 5],
    ],
  },
  {
    id: "legend", title: "Легендарный", price: 2300, box: "gold",
    prizes: [
      ["intelligencecup", "Intelligence Cup", 1020.0, "intelligencecup.png", 3228, 1],
      ["algorithmcup", "Algorithm Cup", 1505.0, "algorithmcup.png", 2716, 2],
      ["heartlocket", "Heart Locket", 1550.0, "heartlocket.png", 2681, 3],
      ["plushpepe", "Plush Pepe", 6999.0, "plushpepe.png", 1375, 4],
    ],
  },
];

export const CASES: CaseDef[] = RAW.map((raw) => ({
  id: raw.id,
  title: raw.title,
  price: raw.price,
  box: raw.box,
  prizes: raw.prizes.map(([id, name, value, image, weight, rarity]) => ({
    id, name, value, image, weight, rarity,
  })),
}));
