import type { EnemyDef, BossDef, RewriteDef } from "../types.js";

/**
 * Normal fights are tuned to end in 3-4 turns (SELF_REVIEW P4).
 * `feint` moves are what make Liar's Eye a real combat skill.
 */
export const ENEMIES: EnemyDef[] = [
  {
    id: "E_DOG", name: "Wild Dog", jp: "野犬", hp: 26, tags: ["beast"],
    resist: { fire: 0.8 }, gold: [8, 16], xp: 10,
    moves: [
      { id: "bite", name: "噛みつく", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 7, element: "physical" }] },
      { id: "maul", name: "食い破る", intent: "heavy", weight: 1, effects: [{ kind: "damage", base: 11, element: "physical" }, { kind: "status", status: "bleed", amount: 3, target: "enemy" }] },
      { id: "circle", name: "唸る", intent: "feint", disguisedAs: "heavy", weight: 1, effects: [{ kind: "status", status: "weak", amount: 2, target: "enemy" }] },
    ],
  },
  {
    id: "E_BANDIT", name: "Bandit", jp: "街道の盗賊", hp: 34, tags: ["humanoid", "bandit"],
    resist: {}, gold: [16, 30], xp: 14,
    moves: [
      { id: "slash", name: "斬りつける", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 8, element: "physical" }] },
      { id: "rob", name: "奪う", intent: "special", weight: 1, effects: [{ kind: "damage", base: 5, element: "physical" }] },
      { id: "bluff", name: "構える", intent: "feint", disguisedAs: "defend", weight: 2, effects: [{ kind: "damage", base: 12, element: "physical" }] },
    ],
  },
  {
    id: "E_ROTSOLDIER", name: "Rot Soldier", jp: "腐食兵", hp: 30, tags: ["undead", "metal"],
    resist: { poison: 0, holy: 2.0, lightning: 1.5 }, gold: [10, 18], xp: 13,
    moves: [
      { id: "cleave", name: "振り下ろす", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 9, element: "physical" }] },
      { id: "rust", name: "錆を撒く", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "vulnerable", amount: 2, target: "enemy" }] },
      { id: "brace", name: "固まる", intent: "defend", weight: 1, effects: [{ kind: "guard", amount: 10 }] },
    ],
  },
  {
    id: "E_LEECH", name: "Sewer Leech", jp: "水路の蛭", hp: 40, tags: ["beast", "wet"],
    resist: { lightning: 2.0, fire: 0.5 }, gold: [12, 22], xp: 18,
    moves: [
      { id: "drain", name: "吸いつく", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 8, element: "physical" }, { kind: "heal", amount: 6 }] },
      { id: "spray", name: "汚水を吐く", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "poison", amount: 4, target: "enemy" }] },
      { id: "coil", name: "とぐろを巻く", intent: "feint", disguisedAs: "defend", weight: 1, effects: [{ kind: "damage", base: 14, element: "physical" }] },
    ],
  },
  {
    id: "E_KNIGHT", name: "Order Soldier", jp: "騎士団兵", hp: 38, tags: ["humanoid", "metal", "order"],
    resist: { lightning: 2.0, physical: 0.85 }, gold: [18, 32], xp: 19,
    moves: [
      { id: "thrust", name: "突く", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 10, element: "physical" }] },
      { id: "shieldup", name: "盾を構える", intent: "defend", weight: 2, effects: [{ kind: "guard", amount: 14 }] },
      { id: "falsefeint", name: "誘う", intent: "feint", disguisedAs: "attack", weight: 2, effects: [{ kind: "damage", base: 16, element: "physical" }] },
    ],
  },
  // ---- elites
  {
    id: "E_CAPTAIN", name: "Patrol Captain", jp: "巡回隊長", hp: 72, tags: ["humanoid", "metal", "order", "elite"],
    resist: { lightning: 2.0, physical: 0.8 }, gold: [40, 60], xp: 42,
    moves: [
      { id: "combo", name: "連撃", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 8, element: "physical", hits: 2 }] },
      { id: "command", name: "号令", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "weak", amount: 2, target: "enemy" }] },
      { id: "bait", name: "隙を見せる", intent: "feint", disguisedAs: "defend", weight: 2, effects: [{ kind: "damage", base: 20, element: "physical" }] },
      { id: "wall", name: "構え直す", intent: "defend", weight: 1, effects: [{ kind: "guard", amount: 18 }] },
    ],
  },
  {
    id: "E_BELLGHOST", name: "Belfry Wraith", jp: "鐘楼の亡霊", hp: 64, tags: ["undead", "elite"],
    resist: { holy: 2.0, physical: 0.7, fire: 1.3 }, gold: [36, 56], xp: 40,
    moves: [
      { id: "toll", name: "鐘を鳴らす", intent: "heavy", weight: 2, effects: [{ kind: "damage", base: 16, element: "physical" }] },
      { id: "wail", name: "嘆く", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "fear", amount: 1, target: "enemy" }] },
      { id: "fade", name: "薄れる", intent: "feint", disguisedAs: "heavy", weight: 2, effects: [{ kind: "guard", amount: 20 }] },
    ],
  },
];

export const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e]));

export function getEnemy(id: string): EnemyDef {
  const e = ENEMY_BY_ID.get(id);
  if (!e) throw new Error(`unknown enemy ${id}`);
  return e;
}

export const BOSSES: BossDef[] = [
  {
    id: "B_VANE", name: "Vane, Knight-Commander", jp: "騎士団長ヴェイン", npcId: "N02",
    consolationKnowledge: "K009",
    phases: [
      {
        name: "騎士団長", hp: 110, tags: ["humanoid", "metal", "order", "boss", "noble"],
        resist: { physical: 0.85, lightning: 1.4 },
        moves: [
          { id: "v_thrust", name: "誓いの突き", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 13, element: "physical" }] },
          { id: "v_guard", name: "騎士の構え", intent: "defend", weight: 2, effects: [{ kind: "guard", amount: 20 }] },
          { id: "v_feint", name: "剣を引く", intent: "feint", disguisedAs: "defend", weight: 3, effects: [{ kind: "damage", base: 22, element: "physical" }] },
          { id: "v_press", name: "圧し潰す", intent: "heavy", weight: 2, effects: [{ kind: "damage", base: 19, element: "physical" }, { kind: "status", status: "vulnerable", amount: 2, target: "enemy" }] },
        ],
      },
      {
        name: "誓いの残響", hp: 90, tags: ["undead", "metal", "boss", "phase2"],
        resist: { physical: 0.9, lightning: 1.0, holy: 1.4 },
        moves: [
          { id: "v2_sweep", name: "残響の薙ぎ", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 15, element: "physical" }] },
          { id: "v2_echo", name: "反響", intent: "heavy", weight: 2, effects: [{ kind: "damage", base: 11, element: "physical", hits: 2 }] },
          { id: "v2_grief", name: "悔恨", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "weak", amount: 2, target: "enemy" }, { kind: "damage", base: 6, element: "physical" }] },
          { id: "v2_false", name: "揺らぐ", intent: "feint", disguisedAs: "debuff", weight: 2, effects: [{ kind: "damage", base: 24, element: "physical" }] },
        ],
      },
    ],
  },
  {
    id: "B_SELD", name: "Seld, Chancellor", jp: "宰相セルド", npcId: "N05",
    consolationKnowledge: "K013",
    phases: [
      {
        name: "王の影", hp: 105, tags: ["humanoid", "noble", "boss", "shielded"],
        resist: { physical: 0.9 },
        moves: [
          { id: "s_order", name: "命じる", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 12, element: "physical" }] },
          { id: "s_shield", name: "影武者を前に出す", intent: "defend", weight: 2, effects: [{ kind: "guard", amount: 22 }] },
          { id: "s_lie", name: "諭す", intent: "feint", disguisedAs: "debuff", weight: 2, effects: [{ kind: "damage", base: 20, element: "physical" }] },
        ],
      },
      {
        name: "簒奪者", hp: 105, tags: ["humanoid", "noble", "boss", "phase2"],
        resist: { physical: 0.95, holy: 1.3 },
        moves: [
          { id: "s2_decree", name: "布告", intent: "heavy", weight: 3, effects: [{ kind: "damage", base: 18, element: "physical" }] },
          { id: "s2_grip", name: "掌握", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "vulnerable", amount: 3, target: "enemy" }] },
          { id: "s2_purge", name: "粛清", intent: "attack", weight: 3, effects: [{ kind: "damage", base: 10, element: "physical", hits: 2 }] },
          { id: "s2_mask", name: "微笑む", intent: "feint", disguisedAs: "defend", weight: 2, effects: [{ kind: "damage", base: 26, element: "physical" }] },
        ],
      },
    ],
  },
  {
    id: "B_WRITER", name: "The Writer", jp: "書き手", npcId: "N04",
    consolationKnowledge: "K020",
    phases: [
      {
        name: "書き手", hp: 200, tags: ["boss", "writer", "phase2"],
        resist: { physical: 0.9 },
        moves: [
          { id: "w_erase", name: "消す", intent: "heavy", weight: 3, effects: [{ kind: "damage", base: 20, element: "physical" }] },
          { id: "w_revise", name: "書き直す", intent: "debuff", weight: 2, effects: [{ kind: "status", status: "weak", amount: 3, target: "enemy" }] },
          { id: "w_quote", name: "引用する", intent: "feint", disguisedAs: "attack", weight: 3, effects: [{ kind: "damage", base: 30, element: "physical" }] },
        ],
      },
    ],
  },
];

export const BOSS_BY_ID = new Map(BOSSES.map((b) => [b.id, b]));

export function getBoss(id: string): BossDef {
  const b = BOSS_BY_ID.get(id);
  if (!b) throw new Error(`unknown boss ${id}`);
  return b;
}

/**
 * REWRITE actions.  Every effect here is deterministic and engine-owned;
 * the LLM only narrates the aftermath.
 * Note every single one burns Knowledge — that is the paradox, in data form.
 */
export const REWRITES: RewriteDef[] = [
  {
    id: "RW01", title: "密会を予告する", targetNpc: "N01",
    utterance: "「今夜22時、あんたは教会で騎士団長と会うだろう」",
    requires: ["K005"], timeCost: 60,
    preview: [
      "22時の密会が消滅する",
      "騎士団長が警戒し、城下町に「粛清」が発生する",
      "K005 / K021 が Invalidated になる",
      "Distortion +2",
    ],
    effects: [
      { kind: "cancelScheduledEvent", eventId: "EV_CHURCH_MEETING_22" },
      { kind: "npcFlag", npc: "N02", flag: "alerted" },
      { kind: "injectNode", act: 2, nodeId: "NODE_PURGE" },
      { kind: "removeNode", nodeId: "NODE_CHURCH_NIGHT" },
      { kind: "invalidate", knowledge: ["K005", "K021"] },
      { kind: "trust", npc: "N01", delta: -2 },
      { kind: "suspicion", delta: 3 },
      { kind: "distortion", delta: 2 },
    ],
  },
  {
    id: "RW02", title: "王に毒を警告する", targetNpc: "N05",
    utterance: "「今夜、王の杯に毒が入る」",
    requires: ["K013"], timeCost: 60,
    preview: [
      "王が生存し、城に味方の衛兵が立つ",
      "ボスが宰相セルドに差し替わる",
      "K013 が Invalidated になる",
      "Distortion +2",
    ],
    effects: [
      { kind: "cancelScheduledEvent", eventId: "EV_KING_POISON" },
      { kind: "npcFlag", npc: "N05", flag: "exposed_early" },
      { kind: "allyNextFight" },
      { kind: "swapBoss", to: "B_SELD" },
      { kind: "invalidate", knowledge: ["K013"] },
      { kind: "suspicion", delta: 2 },
      { kind: "distortion", delta: 2 },
    ],
  },
  {
    id: "RW03", title: "王女を本名で呼ぶ", targetNpc: "N05",
    utterance: "「リゼ様は3年前に亡くなられた。あなたは誰だ」",
    requires: ["K007"], requiresConfirmed: ["K007"], timeCost: 60,
    preview: [
      "偽王女が城から逃走し、城・広間が空室になる",
      "宰相セルドが表に出る → ボスが差し替わる",
      "城下町に「粛清」が発生する",
      "K007 が Invalidated になる（[偽物だと告げる] が使えなくなる）",
      "Distortion +3",
    ],
    effects: [
      { kind: "npcFlag", npc: "N05", flag: "unmasked" },
      { kind: "removeNode", nodeId: "NODE_CASTLE_HALL" },
      { kind: "injectNode", act: 2, nodeId: "NODE_PURGE" },
      { kind: "swapBoss", to: "B_SELD" },
      { kind: "invalidate", knowledge: ["K007"] },
      { kind: "suspicion", delta: 4 },
      { kind: "distortion", delta: 3 },
    ],
  },
  {
    id: "RW04", title: "墓守に鍵のことを告げる", targetNpc: "N04",
    utterance: "「その鍵は灰の塔の扉を開ける」",
    requires: ["K015"], timeCost: 60,
    preview: [
      "灰の鍵を入手し、塔ルートが解禁される",
      "ネルが次の Run で死亡している",
      "K015 / K002 が Invalidated になる",
      "Distortion +3",
    ],
    effects: [
      { kind: "grantItem", item: "I_GRAVEKEY" },
      { kind: "unlockRoute", routeId: "tower" },
      { kind: "killNpc", npc: "N04" },
      { kind: "invalidate", knowledge: ["K015", "K002"] },
      { kind: "distortion", delta: 3 },
    ],
  },
  {
    id: "RW05", title: "盗賊の正体を突く", targetNpc: "N02",
    utterance: "「お前たち、元は騎士団だろう」",
    requires: ["K011"], timeCost: 60,
    preview: [
      "盗賊が味方化し、街道が安全になる（1 戦だけ援軍）",
      "騎士団が盗賊を討伐 → 森の危険度 +2",
      "K011 が Invalidated になる",
      "Distortion +1",
    ],
    effects: [
      { kind: "allyNextFight" },
      { kind: "dangerShift", region: "road", delta: -1 },
      { kind: "dangerShift", region: "forest", delta: 2 },
      { kind: "invalidate", knowledge: ["K011"] },
      { kind: "distortion", delta: 1 },
    ],
  },
  {
    id: "RW06", title: "司祭に入れ替わりを問い詰める", targetNpc: "N03",
    utterance: "「影武者を用意したのはあなたですね」",
    requires: ["K007", "K014"], timeCost: 60,
    preview: [
      "司祭が自白し、真犯人が明らかになる",
      "その後、司祭は自ら命を絶つ",
      "教会が発見ノードに変わる",
      "K014 / K022 が Invalidated になる",
      "Distortion +2",
    ],
    effects: [
      { kind: "npcFlag", npc: "N03", flag: "confessed" },
      { kind: "killNpc", npc: "N03" },
      { kind: "injectNode", act: 2, nodeId: "NODE_CHURCH_UNDER" },
      { kind: "invalidate", knowledge: ["K014", "K022"] },
      { kind: "suspicion", delta: 1 },
      { kind: "distortion", delta: 2 },
    ],
  },
];

export const REWRITE_BY_ID = new Map(REWRITES.map((r) => [r.id, r]));
