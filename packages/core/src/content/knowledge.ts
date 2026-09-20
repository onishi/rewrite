import type { KnowledgeDef, SynthesisRule } from "../types.js";

/**
 * Knowledge is NOT prose.  Every entry unlocks a rule.
 * 16 of the 20 base entries touch combat, routing or the clock, so the system
 * keeps its teeth even with the LLM switched off (SELF_REVIEW Q2).
 */
export const KNOWLEDGE: KnowledgeDef[] = [
  {
    id: "K001", title: "森の霧は夜明けに晴れる",
    description: "森の霧は日の出とともに退く。早い時間に抜ければ迷わずに済む。",
    baseReliability: "confirmed",
    relatedNPCs: [], relatedLocations: ["forest"], tags: ["route"],
    conditions: ["森ノードにいること"],
    gameplayEffects: [{ kind: "timeCost", nodeTag: "forest", delta: -60 }],
    effectLabels: ["森ノードの所要時間 −1h"],
  },
  {
    id: "K002", title: "墓守は生者を憎んでいない",
    description: "墓地で襲ってくるのは墓守ではない。彼は誰かを探しているだけだ。",
    baseReliability: "confirmed",
    relatedNPCs: ["N04"], relatedLocations: ["graveyard"], tags: ["social", "route"],
    conditions: ["墓地ノードにいること"],
    gameplayEffects: [{ kind: "convertEncounter", nodeTag: "gravekeeper", to: "social" }],
    effectLabels: ["墓守との遭遇が戦闘 → 会話に変わる"],
  },
  {
    id: "K003", title: "宿屋の地下に隠し入口がある",
    description: "ハルガの宿の床下に、使われていない通路がある。",
    baseReliability: "confirmed",
    relatedNPCs: ["N01"], relatedLocations: ["village"], tags: ["route"],
    conditions: ["村にいること"],
    gameplayEffects: [{ kind: "revealNode", nodeId: "NODE_INN_CELLAR" }],
    effectLabels: ["村に隠しノード「宿屋の地下」が出現"],
  },
  {
    id: "K004", title: "騎士団長は火を恐れている",
    description: "ヴェインは炎を前にすると剣先が揺れる。焼けた記憶があるのだろう。",
    baseReliability: "confirmed",
    relatedNPCs: ["N02"], relatedLocations: ["castle"], tags: ["combat"],
    conditions: ["騎士団長と戦闘中であること"],
    gameplayEffects: [{ kind: "unlockSpecialAction", actionId: "SA_TORCH", scope: "boss" }],
    effectLabels: ["ボス戦に [松明を突きつける] が追加（Fear 付与）"],
  },
  {
    id: "K005", title: "騎士団長は22時に教会へ行く",
    description: "ヴェインは毎晩22時、供も連れず教会の裏口へ向かう。",
    baseReliability: "uncertain",
    relatedNPCs: ["N02", "N03"], relatedLocations: ["church"], tags: ["schedule"],
    conditions: ["22時以降であること"],
    gameplayEffects: [{ kind: "revealNode", nodeId: "NODE_CHURCH_NIGHT" }],
    effectLabels: ["22時の教会に尾行イベントが出現"],
  },
  {
    id: "K006", title: "宿屋の主人も22時に外出する",
    description: "ハルガは22時に宿を空ける。行き先は言わない。",
    baseReliability: "uncertain",
    relatedNPCs: ["N01"], relatedLocations: ["village"], tags: ["schedule"],
    conditions: ["22時以降であること"],
    gameplayEffects: [{ kind: "revealNode", nodeId: "NODE_INN_EMPTY" }],
    effectLabels: ["22時の宿屋が無人になり侵入可能"],
  },
  {
    id: "K007", title: "王女は偽物である",
    description: "王女リゼは3年前に死んでいる。今いるのは誰かが用意した影武者だ。",
    baseReliability: "confirmed",
    relatedNPCs: ["N05", "N03"], relatedLocations: ["castle"], tags: ["truth", "royal"],
    conditions: [],
    gameplayEffects: [
      { kind: "unlockSpecialAction", actionId: "SA_EXPOSE_PRINCESS", scope: "boss" },
      { kind: "unlockRewrite", rewriteId: "RW03" },
      { kind: "discloseTruth", truthId: "WT02" },
      { kind: "endingCondition", endingId: "E2" },
    ],
    effectLabels: [
      "ボス戦に [偽物だと告げる] が追加",
      "REWRITE「王女を本名で呼ぶ」が解禁",
      "世界の真実 WT02 が開示",
      "Ending B の条件を1つ満たした",
    ],
  },
  {
    id: "K008", title: "地下水路は城の井戸に繋がる",
    description: "水路の北端の格子の先は、城の中庭の井戸の底だ。",
    baseReliability: "confirmed",
    relatedNPCs: [], relatedLocations: ["sewer", "castle"], tags: ["route"],
    conditions: ["地下水路を通過していること"],
    gameplayEffects: [{ kind: "unlockRoute", from: "sewer", to: "castle", stepsSaved: 1 }],
    effectLabels: ["水路 → 城 のショートカット（1ステップ・2h 短縮）"],
  },
  {
    id: "K009", title: "ボスの第二形態は雷に弱い",
    description: "誓いの残響は鋼でできている。雷はそれを内側から焼く。",
    baseReliability: "confirmed",
    relatedNPCs: ["N02"], relatedLocations: ["castle"], tags: ["combat"],
    conditions: ["第二形態であること"],
    gameplayEffects: [
      { kind: "elementMultiplier", target: "boss_phase2", element: "lightning", mult: 2 },
      { kind: "unlockSpecialAction", actionId: "SA_LIGHTNING", scope: "boss" },
    ],
    effectLabels: ["第二形態への雷ダメージ ×2", "ボス戦に [雷を撃ち込む] が追加"],
  },
  {
    id: "K010", title: "聖水は不死者を一撃で滅ぼす",
    description: "腐った兵に聖水を一滴。それだけで足りる。",
    baseReliability: "confirmed",
    relatedNPCs: ["N03"], relatedLocations: ["church", "graveyard"], tags: ["combat"],
    conditions: ["聖水を所持していること"],
    gameplayEffects: [{ kind: "itemEffect", itemId: "I_HOLYWATER", vs: "undead", effect: "instantKill" }],
    effectLabels: ["聖水が Undead に即死効果を持つ"],
  },
  {
    id: "K011", title: "街道の盗賊は元騎士団の兵である",
    description: "彼らの剣の握りは騎士団の型だ。捨てられた者たちだ。",
    baseReliability: "confirmed",
    relatedNPCs: ["N02"], relatedLocations: ["road"], tags: ["social", "combat"],
    conditions: ["盗賊と対峙していること"],
    gameplayEffects: [
      { kind: "enableNegotiation", enemyTag: "bandit" },
      { kind: "unlockRewrite", rewriteId: "RW05" },
    ],
    effectLabels: ["盗賊と無条件で交渉可能（Silver Tongue 不要）", "REWRITE「盗賊の正体を突く」が解禁"],
  },
  {
    id: "K012", title: "教会の地下に「最初の書き換え」の記録がある",
    description: "礼拝堂の床石の下に、同じ日付が何度も書かれた帳簿がある。",
    baseReliability: "confirmed",
    relatedNPCs: ["N03"], relatedLocations: ["church"], tags: ["lore"],
    conditions: [],
    gameplayEffects: [
      { kind: "revealNode", nodeId: "NODE_CHURCH_UNDER" },
      { kind: "discloseTruth", truthId: "WT05" },
    ],
    effectLabels: ["教会に隠し発見ノードが出現", "世界の真実 WT05 が開示"],
  },
  {
    id: "K013", title: "王は今夜毒を盛られる",
    description: "厨房に、王の卓にだけ使われる小瓶がある。中身は葡萄酒ではない。",
    baseReliability: "uncertain",
    relatedNPCs: ["N05"], relatedLocations: ["castle"], tags: ["schedule"],
    conditions: ["城にいること"],
    gameplayEffects: [{ kind: "unlockRewrite", rewriteId: "RW02" }],
    effectLabels: ["REWRITE「王に毒を警告する」が解禁", "城イベントで毒殺阻止行動が解禁"],
  },
  {
    id: "K014", title: "司祭は王女の入れ替わりを知っている",
    description: "オルドは王女の名を呼ぶとき、必ず一拍おく。",
    baseReliability: "uncertain",
    relatedNPCs: ["N03"], relatedLocations: ["church"], tags: ["social"],
    conditions: ["司祭と会話していること"],
    gameplayEffects: [{ kind: "unlockSpecialAction", actionId: "SA_PRESS_PRIEST", scope: "social" }],
    effectLabels: ["司祭を問い詰める選択肢が解禁"],
  },
  {
    id: "K015", title: "灰の塔の鍵は墓守が持つ",
    description: "ネルは首から古い鍵を下げている。姉の形見だという。",
    baseReliability: "uncertain",
    relatedNPCs: ["N04"], relatedLocations: ["graveyard", "tower"], tags: ["route"],
    conditions: ["墓守が生存していること"],
    gameplayEffects: [
      { kind: "unlockRewrite", rewriteId: "RW04" },
      { kind: "unlockRoute", from: "graveyard", to: "tower", stepsSaved: 0 },
    ],
    effectLabels: ["墓守から鍵を入手可能に", "塔ルートの前提条件を1つ満たした"],
  },
  {
    id: "K016", title: "ループの起点は「灰の日」である",
    description: "全ては灰の降った一日から始まっている。何度も。",
    baseReliability: "confirmed",
    relatedNPCs: [], relatedLocations: ["church"], tags: ["lore", "meta"],
    conditions: [],
    gameplayEffects: [
      { kind: "discloseTruth", truthId: "WT09" },
      { kind: "revealNode", nodeId: "NODE_ASH_TOWER" },
    ],
    effectLabels: ["灰の塔への入口が地図に現れる", "世界の真実 WT09 が開示"],
  },
  {
    id: "K017", title: "騎士団長もループを記憶している",
    description: "ヴェインは覚えている。お前が何度来たのかも、何を知っているのかも。",
    baseReliability: "confirmed",
    relatedNPCs: ["N02"], relatedLocations: ["castle"], tags: ["meta"],
    conditions: ["Run 3 以降"],
    gameplayEffects: [{ kind: "discloseTruth", truthId: "WT03" }],
    effectLabels: [
      "ヴェインがプレイヤーの Knowledge に対策を取るようになる（難化）",
      "ヴェインとの新しい会話ルートが解禁",
    ],
  },
  {
    id: "K018", title: "「書き手」は塔の頂にいる",
    description: "灰の塔の頂に、この世界を書いている者がいる。",
    baseReliability: "confirmed",
    relatedNPCs: [], relatedLocations: ["tower"], tags: ["lore"],
    conditions: ["塔ルート解禁済み"],
    gameplayEffects: [{ kind: "discloseTruth", truthId: "WT06" }, { kind: "endingCondition", endingId: "E3" }],
    effectLabels: ["True Boss「書き手」が出現可能に", "Ending C の条件を1つ満たした"],
  },
  {
    id: "K019", title: "REWRITEには代償がある",
    description: "書き換えるたび世界は薄くなる。薄くなりきったとき、灰が降る。",
    baseReliability: "confirmed",
    relatedNPCs: [], relatedLocations: [], tags: ["meta"],
    conditions: [],
    gameplayEffects: [{ kind: "discloseTruth", truthId: "WT09" }],
    effectLabels: ["Distortion メーターが可視化される"],
  },
  {
    id: "K020", title: "主人公自身が最初の書き換えの産物である",
    description: "お前は生まれていない。誰かが、お前がいることにした。",
    baseReliability: "confirmed",
    relatedNPCs: ["N04"], relatedLocations: ["tower"], tags: ["truth", "meta"],
    conditions: ["K018 を所持していること"],
    gameplayEffects: [
      { kind: "discloseTruth", truthId: "WT07" },
      { kind: "discloseTruth", truthId: "WT08" },
      { kind: "endingCondition", endingId: "E3" },
    ],
    effectLabels: ["世界の真実 WT07 / WT08 が開示", "Ending C（True Ending）の条件を満たした"],
  },

  // ------------------------------------------------------------ synthesized
  {
    id: "K021", title: "二人は教会で密会している可能性がある",
    description: "同じ時刻に、同じ方角へ。偶然ではない。",
    baseReliability: "uncertain",
    relatedNPCs: ["N01", "N02"], relatedLocations: ["church"], tags: ["schedule", "social"],
    conditions: ["22時に教会にいること"],
    gameplayEffects: [
      { kind: "revealNode", nodeId: "NODE_SECRET_MEETING" },
      { kind: "unlockRewrite", rewriteId: "RW01" },
    ],
    effectLabels: ["22時の教会に密会ノードが確定出現", "REWRITE「密会を予告する」が解禁"],
    synthesizedFrom: ["K005", "K006"],
  },
  {
    id: "K022", title: "司祭が入れ替わりを手配した",
    description: "影武者を用意したのは教会だ。だが指示した者は他にいる。",
    baseReliability: "uncertain",
    relatedNPCs: ["N03", "N05"], relatedLocations: ["church"], tags: ["truth", "social"],
    conditions: [],
    gameplayEffects: [
      { kind: "unlockRewrite", rewriteId: "RW06" },
      { kind: "discloseTruth", truthId: "WT01" },
      { kind: "endingCondition", endingId: "E2" },
    ],
    effectLabels: ["REWRITE「司祭を問い詰める」が解禁", "世界の真実 WT01 が開示", "Ending B の条件を満たした"],
    synthesizedFrom: ["K007", "K014"],
  },
  {
    id: "K023", title: "騎士団長は雷への耐性を身につけつつある",
    description: "お前が雷を使うたび、あの男は備える。",
    baseReliability: "confirmed",
    relatedNPCs: ["N02"], relatedLocations: ["castle"], tags: ["combat", "meta"],
    conditions: [],
    gameplayEffects: [],
    effectLabels: ["⚠ K009「第二形態は雷に弱い」が Uncertain に格下げされた"],
    synthesizedFrom: ["K009", "K017"],
  },
  {
    id: "K024", title: "毒は宿屋の地下から運ばれる",
    description: "王の卓に届く小瓶は、ハルガの床下の棚から来ている。",
    baseReliability: "uncertain",
    relatedNPCs: ["N01", "N05"], relatedLocations: ["village", "castle"], tags: ["route", "truth"],
    conditions: ["宿屋の地下に入れること"],
    gameplayEffects: [{ kind: "discloseTruth", truthId: "WT04" }],
    effectLabels: ["宿屋の地下で毒の出所を押さえられる", "世界の真実 WT04 が開示"],
    synthesizedFrom: ["K013", "K003"],
  },
  {
    id: "K025", title: "灰の日はREWRITEの累積で起きた",
    description: "灰を降らせたのは誰でもない。書き換えの回数そのものだ。",
    baseReliability: "confirmed",
    relatedNPCs: [], relatedLocations: ["tower"], tags: ["lore", "meta"],
    conditions: [],
    gameplayEffects: [
      { kind: "discloseTruth", truthId: "WT09" },
      { kind: "discloseTruth", truthId: "WT10" },
    ],
    effectLabels: ["世界の真実 WT09 / WT10 が開示", "Ending C ルートの中核が判明"],
    synthesizedFrom: ["K016", "K019"],
  },
];

export const KNOWLEDGE_BY_ID = new Map(KNOWLEDGE.map((k) => [k.id, k]));

export function getKnowledge(id: string): KnowledgeDef {
  const k = KNOWLEDGE_BY_ID.get(id);
  if (!k) throw new Error(`unknown knowledge ${id}`);
  return k;
}

/** Combinations that fire automatically the moment both halves are held. */
export const SYNTHESIS_RULES: SynthesisRule[] = [
  { id: "K021", requires: ["K005", "K006"] },
  { id: "K022", requires: ["K007", "K014"] },
  { id: "K023", requires: ["K009", "K017"] },
  { id: "K024", requires: ["K013", "K003"] },
  { id: "K025", requires: ["K016", "K019"] },
];

/** "one more piece and these connect" hints for the codex screen. */
export function nearSynthesis(held: Set<string>): { id: string; missing: string[] }[] {
  const out: { id: string; missing: string[] }[] = [];
  for (const rule of SYNTHESIS_RULES) {
    if (held.has(rule.id)) continue;
    const missing = rule.requires.filter((r) => !held.has(r));
    if (missing.length === 1) out.push({ id: rule.id, missing });
  }
  return out;
}
