import type { NpcDef, WorldTruthDef, ItemDef } from "../types.js";

/** Fixed at world creation and never regenerated.  The AI may not contradict these. */
export const WORLD_TRUTHS: WorldTruthDef[] = [
  { id: "WT01", statement: "真犯人は司祭ではなく宰相セルドである。", revealedBy: ["K022"] },
  { id: "WT02", statement: "王女リゼは3年前に死んでおり、現在の王女は宰相が用意した影武者である。", revealedBy: ["K007"] },
  { id: "WT03", statement: "騎士団長ヴェインは王女の死を知っており、その罪悪感がループを記憶する体質を招いた。", revealedBy: ["K017"] },
  { id: "WT04", statement: "宿屋の主人ハルガは元王宮の毒見役である。", revealedBy: ["K024"] },
  { id: "WT05", statement: "教会の地下には「灰の日」の記録が保管されている。", revealedBy: ["K012"] },
  { id: "WT06", statement: "ループの原因は灰の塔の頂にいる「書き手」である。", revealedBy: ["K018"] },
  { id: "WT07", statement: "「書き手」は墓守ネルの姉であり、同時に主人公の姉でもある。", revealedBy: ["K020"] },
  { id: "WT08", statement: "主人公は最初のREWRITEによって生まれた、本来存在しない人間である。", revealedBy: ["K020"] },
  { id: "WT09", statement: "REWRITEのたびにDistortionが増え、限界を超えると世界は灰になる。", revealedBy: ["K016", "K019", "K025"] },
  { id: "WT10", statement: "「灰の日」はすでに5回起きている。", revealedBy: ["K025"] },
];

export const NPCS: NpcDef[] = [
  {
    id: "N01", name: "Halga", jp: "ハルガ", role: "宿屋の主人",
    publicGoal: "宿を続けたい",
    trueGoal: "元王宮の毒見役であった過去を隠し通したい",
    personality: "無愛想。情に厚い。嘘が下手で、嘘をつくと手が止まる。",
    lies: ["王宮に行ったことなどない", "夜は宿から出ない"],
    dejaVuFromRun: 6,
    dejaVuLines: ["……いらっしゃい。", "……お前、前にもその顔をしていたな。", "また来たのか。何度目だ。", "今度は何を変えるつもりだ。俺の床下か？"],
  },
  {
    id: "N02", name: "Vane", jp: "ヴェイン", role: "騎士団長 / Boss A",
    publicGoal: "王国の秩序を守る",
    trueGoal: "王女の死を知りながら沈黙し続けた罪から逃げている",
    personality: "実直。頑固。自罰的。火を前にすると声が硬くなる。",
    lies: ["王女はご健在だ", "私は何も知らない"],
    dejaVuFromRun: 3,
    dejaVuLines: ["何者だ。", "……以前、会ったことがあるか？", "また、お前か。", "今度は何を書き換えるつもりだ？"],
  },
  {
    id: "N03", name: "Ordo", jp: "オルド", role: "司祭",
    publicGoal: "教会と信徒を守る",
    trueGoal: "王女の入れ替わりを手配した共犯として、記録を封じたい",
    personality: "慇懃。雄弁。常習的に嘘をつくが、王女の名の前で一拍おく癖がある。",
    lies: ["王女様のことは存じ上げません", "地下には何もありません", "私は祈るだけの者です"],
    dejaVuFromRun: 99,
    dejaVuLines: ["主の祝福を。"],
  },
  {
    id: "N04", name: "Nel", jp: "ネル", role: "墓守",
    publicGoal: "埋葬を続ける",
    trueGoal: "失踪した姉を探している",
    personality: "子ども。率直で、恐れを知らない。嘘をつかない。",
    lies: [],
    dejaVuFromRun: 8,
    dejaVuLines: ["掘ってるだけだよ。", "……あなた、前にもここにいた気がする。", "また来たね。姉さんのこと、何か分かった？"],
  },
  {
    id: "N05", name: "Seld", jp: "セルド", role: "宰相 / Boss B",
    publicGoal: "王を補佐する",
    trueGoal: "王権を簒奪する。事件の真犯人。",
    personality: "温厚な仮面。計算高い。感情が乱れることはない。",
    lies: ["王国の安寧こそ私の望みです", "王女様はお休みです"],
    dejaVuFromRun: 10,
    dejaVuLines: ["ようこそ。", "……妙だ。あなたを、知っている気がする。", "また戻ってきましたね。今度も無駄ですよ。"],
  },
];

export const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]));

/** 20 items.  Torch / holy water / lightning vial exist so Knowledge has hardware. */
export const ITEMS: ItemDef[] = [
  { id: "I_TORCH", name: "Torch", jp: "松明", price: 30, rarity: "common", kind: "relic",
    desc: "火。暗がりと、火を恐れる者に効く。", effects: [], tags: ["fire", "light"] },
  { id: "I_HOLYWATER", name: "Holy Water", jp: "聖水", price: 45, rarity: "uncommon", kind: "consumable",
    desc: "不死者に 25 の聖ダメージ。", effects: [{ kind: "damage", base: 25, element: "holy" }], tags: ["holy"] },
  { id: "I_STORMVIAL", name: "Storm Vial", jp: "雷の雫", price: 60, rarity: "rare", kind: "consumable",
    desc: "雷 32 ダメージ。", effects: [{ kind: "damage", base: 32, element: "lightning" }], tags: ["lightning"] },
  { id: "I_BANDAGE", name: "Bandage", jp: "包帯", price: 20, rarity: "common", kind: "consumable", quick: true,
    desc: "HP 18 回復。", effects: [{ kind: "heal", amount: 18 }], tags: ["heal"] },
  { id: "I_ELIXIR", name: "Elixir", jp: "霊薬", price: 55, rarity: "uncommon", kind: "consumable", quick: true,
    desc: "HP 38 回復。", effects: [{ kind: "heal", amount: 38 }], tags: ["heal"] },
  { id: "I_ANTIDOTE", name: "Antidote", jp: "解毒薬", price: 25, rarity: "common", kind: "consumable", quick: true,
    desc: "毒と出血を打ち消す。", effects: [], tags: ["cure"] },
  { id: "I_POISONVIAL", name: "Poison Vial", jp: "毒瓶", price: 35, rarity: "common", kind: "consumable",
    desc: "Poison 8 を与える。杯にも盛れる。", effects: [{ kind: "status", status: "poison", amount: 8, target: "enemy" }], tags: ["poison"] },
  { id: "I_IRONCHARM", name: "Iron Charm", jp: "鉄の護符", price: 40, rarity: "common", kind: "relic",
    desc: "最大 HP +12。", effects: [], tags: ["maxhp"] },
  { id: "I_ASHWATCH", name: "Ash Pocketwatch", jp: "灰の懐中時計", price: 80, rarity: "rare", kind: "relic",
    desc: "移動時間 −30分。", effects: [], tags: ["time"] },
  { id: "I_FALSECREST", name: "False Crest", jp: "偽の紋章", price: 50, rarity: "uncommon", kind: "relic",
    desc: "Suspicion の上昇が半分になる。", effects: [], tags: ["social"] },
  { id: "I_EAVESDROP", name: "Listening Ear", jp: "盗聴の耳", price: 65, rarity: "uncommon", kind: "relic",
    desc: "Social ノードで Knowledge の入手確率が上がる。", effects: [], tags: ["knowledge"] },
  { id: "I_BLOODNOTE", name: "Bloodied Notebook", jp: "血塗れの手帳", price: 90, rarity: "rare", kind: "consumable",
    desc: "Uncertain な Knowledge を 1 つ Confirmed にする。", effects: [], tags: ["knowledge"] },
  { id: "I_WHETSTONE", name: "Whetstone", jp: "砥石", price: 35, rarity: "common", kind: "relic",
    desc: "攻撃力 +3。", effects: [], tags: ["power"] },
  { id: "I_FOCUSRING", name: "Focus Ring", jp: "集中の指輪", price: 55, rarity: "uncommon", kind: "relic",
    desc: "最大 Focus +2。", effects: [], tags: ["focus"] },
  { id: "I_SMOKEBOMB", name: "Smoke Bomb", jp: "煙玉", price: 30, rarity: "common", kind: "consumable", quick: true,
    desc: "戦闘から確実に離脱する。", effects: [], tags: ["escape"] },
  { id: "I_OILFLASK", name: "Oil Flask", jp: "油壺", price: 28, rarity: "common", kind: "consumable",
    desc: "Burn 10 を与える。", effects: [{ kind: "status", status: "burn", amount: 10, target: "enemy" }], tags: ["fire"] },
  { id: "I_SALTLINE", name: "Line of Salt", jp: "塩の線", price: 30, rarity: "common", kind: "consumable", quick: true,
    desc: "Guard 24 を得る。", effects: [{ kind: "guard", amount: 24 }], tags: ["guard"] },
  { id: "I_GRAVEKEY", name: "Ashen Key", jp: "灰の鍵", price: 0, rarity: "rare", kind: "relic",
    desc: "灰の塔の扉を開く。", effects: [], tags: ["key", "quest"] },
  { id: "I_SIGNETRING", name: "Signet Ring", jp: "王家の印章", price: 70, rarity: "rare", kind: "relic",
    desc: "royal な Knowledge の効果が Confirmed 扱いになる。", effects: [], tags: ["royal"] },
  { id: "I_DOGWHISTLE", name: "Dog Whistle", jp: "犬笛", price: 22, rarity: "common", kind: "relic",
    desc: "犬を呼べる。城の厨房で役に立つかもしれない。", effects: [], tags: ["odd"] },
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): ItemDef {
  const i = ITEM_BY_ID.get(id);
  if (!i) throw new Error(`unknown item ${id}`);
  return i;
}

export const ENDINGS = [
  { id: "E1", name: "事件は解決した", desc: "騎士団長を倒し、村は静けさを取り戻す。何も変わらない。ループは続く。" },
  { id: "E2", name: "陰謀は暴かれた", desc: "宰相セルドを倒し、影武者の真実が明かされる。王国は救われる。ループは続く。" },
  { id: "E3", name: "REWRITE", desc: "塔の頂で「書き手」と対面し、ループそのものを書き換える。" },
] as const;
