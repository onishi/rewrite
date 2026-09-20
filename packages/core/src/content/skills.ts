import type { SkillDef, SynergyDef } from "../types.js";

/**
 * 20 skills.  13 of them do something outside combat as well (`kind: "world"`
 * or `"both"`), because the design forbids separating build-craft from
 * story-craft.
 *
 * `pool` matters: skills with no combat value never appear in a combat reward
 * (SELF_REVIEW P2) so the 3-card pick is never a dud.
 */
export const SKILLS: SkillDef[] = [
  {
    id: "S01", name: "Liar's Eye", jp: "嘘看破の眼", kind: "both", pool: "both",
    focusCost: 1, active: true, target: "enemy",
    desc: "敵のフェイントを見破る。偽の予告をしていた敵に +30% ダメージ。",
    worldDesc: "嘘をついている NPC が分かり、専用の選択肢が出る。",
    effects: [{ kind: "damage", base: 9, element: "physical" }],
    passives: ["detectFeint"],
  },
  {
    id: "S02", name: "Necromancy", jp: "死霊術", kind: "both", pool: "both",
    focusCost: 2, active: true, target: "enemy",
    desc: "闇の一撃。敵を倒すとその敵の技を Echo として 1 回分得る。",
    worldDesc: "死体と会話して Knowledge を得る。",
    effects: [{ kind: "damage", base: 12, element: "physical" }],
    passives: ["necromancy"],
  },
  {
    id: "S03", name: "Premonition", jp: "予知", kind: "both", pool: "both",
    focusCost: 0, active: false, target: "none",
    desc: "敵の予告の数値と対象が見える。",
    worldDesc: "イベント選択肢に危険度が表示される。",
    effects: [],
    passives: ["seeIntentValues"],
  },
  {
    id: "S04", name: "Silver Tongue", jp: "銀の舌", kind: "both", pool: "both",
    focusCost: 2, active: true, target: "enemy",
    desc: "人型の敵に交渉を持ちかけ、戦闘を終わらせる。",
    worldDesc: "交渉成功率 +30%、買値 −20%。",
    effects: [],
    passives: ["negotiate"],
  },
  {
    id: "S05", name: "Blood Price", jp: "血の代償", kind: "both", pool: "both",
    focusCost: 0, active: true, target: "self",
    desc: "HP を 8 払い、次の攻撃に +16 ダメージ。",
    worldDesc: "HP を払って危険な Knowledge を強引に取得できる。",
    effects: [{ kind: "payHp", amount: 8 }, { kind: "bonusNextAttack", amount: 16 }],
    passives: [],
  },
  {
    id: "S06", name: "Assassin", jp: "暗殺者", kind: "both", pool: "both",
    focusCost: 2, active: true, target: "enemy",
    desc: "予告が判明している敵への先制攻撃は確定クリティカル。",
    worldDesc: "夜のノードでは奇襲で敵を 1 体減らして戦闘を始める。",
    effects: [{ kind: "damage", base: 14, element: "physical" }],
    passives: ["firstStrikeCrit"],
  },
  {
    id: "S07", name: "Torchbearer", jp: "松明持ち", kind: "both", pool: "both",
    focusCost: 1, active: true, target: "enemy",
    desc: "炎の一撃。通常攻撃にも毎ターン 1 度 Burn 3 が乗る。",
    worldDesc: "暗いノードの隠し要素が見える。火を恐れる相手に特殊行動。",
    effects: [{ kind: "damage", base: 8, element: "fire" }, { kind: "status", status: "burn", amount: 4, target: "enemy" }],
    passives: ["burnOnHit"],
  },
  {
    id: "S08", name: "Ironblood", jp: "鉄血", kind: "combat", pool: "combat",
    focusCost: 0, active: false, target: "none",
    desc: "Defend で得る Guard が 2 倍になり、次のターンまで持ち越される。",
    effects: [],
    passives: ["guardDouble", "guardCarry"],
  },
  {
    id: "S09", name: "Chronicler", jp: "記録者", kind: "world", pool: "explore",
    focusCost: 0, active: false, target: "none",
    desc: "発見ノードで得る Knowledge が +1。Knowledge 取得の時間コストが 0 になる。",
    worldDesc: "寄り道が実質タダになる。",
    effects: [],
    passives: ["chronicler"],
  },
  {
    id: "S10", name: "Thief's Grace", jp: "盗人の指", kind: "both", pool: "both",
    focusCost: 1, active: true, target: "enemy",
    desc: "斬りつけて Gold を奪う。",
    worldDesc: "店や NPC から盗める（失敗すると Suspicion +2）。",
    effects: [{ kind: "damage", base: 7, element: "physical" }],
    passives: ["steal"],
  },
  {
    id: "S11", name: "Stormcall", jp: "雷招き", kind: "both", pool: "both",
    focusCost: 2, active: true, target: "enemy",
    desc: "雷撃。Wet / Metal の敵に 2 倍。",
    worldDesc: "水路や鉄格子を破壊して近道を開ける。",
    effects: [{ kind: "damage", base: 11, element: "lightning" }],
    passives: ["stormcall"],
  },
  {
    id: "S12", name: "Oathbreaker", jp: "誓い破り", kind: "both", pool: "both",
    focusCost: 1, active: true, target: "allEnemies",
    desc: "協力者を切り捨て、全体に大ダメージ。",
    worldDesc: "約束を破って即時報酬を得る。Suspicion +3、その NPC の信頼は失われる。",
    effects: [{ kind: "damage", base: 13, element: "physical" }],
    passives: ["oathbreaker"],
  },
  {
    id: "S13", name: "Empath", jp: "共感", kind: "both", pool: "both",
    focusCost: 0, active: false, target: "none",
    desc: "敵の弱点属性が見える。",
    worldDesc: "NPC の隠された目的が見える。",
    effects: [],
    passives: ["empath"],
  },
  {
    id: "S14", name: "Second Wind", jp: "第二の息", kind: "combat", pool: "combat",
    focusCost: 0, active: false, target: "none",
    desc: "Run に 1 度、致死ダメージを受けたとき HP 30% で復帰する。",
    effects: [],
    passives: ["secondWind"],
  },
  {
    id: "S15", name: "Royal Knowledge", jp: "王家の典礼", kind: "world", pool: "both",
    focusCost: 0, active: false, target: "none",
    desc: "royal タグの Knowledge を貴族系の敵に特殊行動として使えるようになる。",
    worldDesc: "王族に関する会話選択肢が解禁される。",
    effects: [],
    passives: ["royalKnowledge"],
  },
  {
    id: "S16", name: "Poisoner", jp: "毒使い", kind: "both", pool: "both",
    focusCost: 1, active: true, target: "enemy",
    desc: "毒刃。通常攻撃にも Poison 3 が乗る。毒は Guard を無視する。",
    worldDesc: "食事や杯に毒を盛るイベント行動が解禁される。",
    effects: [{ kind: "damage", base: 6, element: "poison" }, { kind: "status", status: "poison", amount: 4, target: "enemy" }],
    passives: ["poisonOnHit"],
  },
  {
    id: "S17", name: "Echo Step", jp: "残響歩法", kind: "combat", pool: "combat",
    focusCost: 0, active: false, target: "none",
    desc: "戦闘ごとに 1 度、攻撃を完全回避する。Run に 1 度、移動が 2 時間短縮される。",
    effects: [],
    passives: ["dodgeOnce"],
  },
  {
    id: "S18", name: "Martyr's Bargain", jp: "殉教者の取引", kind: "world", pool: "both",
    focusCost: 0, active: false, target: "none",
    desc: "死亡時、Uncertain な Knowledge を 1 つ Confirmed にして死ぬ。",
    worldDesc: "「死んで知識を取る」プレイが正式な戦術になる。",
    effects: [],
    passives: ["martyr"],
  },
  {
    id: "S19", name: "Cold Reading", jp: "読心", kind: "both", pool: "both",
    focusCost: 0, active: false, target: "none",
    desc: "2 ターン先まで予告が見える。戦闘開始時に最大 HP の 10% を失う。",
    worldDesc: "会話で相手の次の発言が 1 つ予告される。",
    effects: [],
    passives: ["seeIntentDepth2"],
  },
  {
    id: "S20", name: "Archivist's Loop", jp: "記録の環", kind: "world", pool: "explore",
    focusCost: 0, active: false, target: "none",
    desc: "Run 開始時に Uncertain な Knowledge を 1 つ Confirmed にする。REWRITE の時間コスト −1h。",
    effects: [],
    passives: ["archivist"],
  },
];

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

export function getSkill(id: string): SkillDef {
  const s = SKILL_BY_ID.get(id);
  if (!s) throw new Error(`unknown skill ${id}`);
  return s;
}

/** 11 synergies.  Y02 / Y03 / Y08 are the "wait, that's broken" ones. */
export const SYNERGIES: SynergyDef[] = [
  { id: "Y01", name: "Lies of the Dead", jp: "死者の嘘", requires: ["S02", "S01"],
    desc: "死体から得る Knowledge が Confirmed になる。Echo 保持数 +1。", grants: ["corpseKnowledgeConfirmed"] },
  { id: "Y02", name: "Foreseen Kill", jp: "予見殺", requires: ["S03", "S06"],
    desc: "予告が見えている敵への攻撃は常にクリティカル。", grants: ["alwaysCritOnKnownIntent"] },
  { id: "Y03", name: "Crown Negotiation", jp: "王家の交渉", requires: ["S04", "S15"],
    desc: "royal な Knowledge があれば、本来不可能な交渉（Boss の回避を含む）が成立する。", grants: ["royalNegotiation"] },
  { id: "Y04", name: "Iron Price", jp: "鉄の代償", requires: ["S05", "S08"],
    desc: "Blood Price で払った HP と同量の Guard を同時に得る。", grants: ["bloodPriceGuard"] },
  { id: "Y05", name: "Stormfire", jp: "嵐火", requires: ["S07", "S11"],
    desc: "同じ敵の Burn と他の状態異常を起爆し、合計スタック ×3 のダメージを与える。", grants: ["detonateStatuses"] },
  { id: "Y06", name: "Poisoned Cup", jp: "毒杯", requires: ["S16", "S04"],
    desc: "社交イベント中の毒殺が露見しなくなる。", grants: ["silentPoison"] },
  { id: "Y07", name: "Total Read", jp: "完全看破", requires: ["S13", "S01"],
    desc: "NPC の真の目的と嘘を同時に表示。敵のフェイントが全て無効化される。", grants: ["fullRead"] },
  { id: "Y08", name: "Posthumous Papers", jp: "遺稿", requires: ["S09", "S18"],
    desc: "死亡時、その Run で得た全ての Uncertain な Knowledge が Confirmed になる。", grants: ["deathConfirmsAll"] },
  { id: "Y09", name: "Shadow Strike", jp: "影撃", requires: ["S17", "S06"],
    desc: "回避に成功した直後の攻撃はクリティカルになり Mark を付与する。", grants: ["critAfterDodge"] },
  { id: "Y10", name: "Gravelooting", jp: "墓荒らし", requires: ["S10", "S02"],
    desc: "死体から Gold と Item もドロップする。", grants: ["corpseLoot"] },
  { id: "Y11", name: "Foresight", jp: "未来視", requires: ["S19", "S03"],
    desc: "3 ターン先まで予告が見える。Cold Reading の HP コストが消える。", grants: ["intentDepth3"] },
];

export function activeSynergies(skills: string[]): SynergyDef[] {
  const owned = new Set(skills);
  return SYNERGIES.filter((s) => s.requires.every((r) => owned.has(r)));
}

/** Which synergy would a candidate skill complete, given the current build? */
export function synergyHintFor(candidate: string, skills: string[]): string | null {
  const owned = new Set(skills);
  if (owned.has(candidate)) return null;
  for (const s of SYNERGIES) {
    if (!s.requires.includes(candidate)) continue;
    const other = s.requires.find((r) => r !== candidate)!;
    if (owned.has(other)) return s.jp;
  }
  return null;
}
