/**
 * REWRITE — core type definitions.
 *
 * Hard rule enforced by these types: nothing an LLM returns can reach a number
 * that matters.  Every numeric field below is written exclusively by the engine.
 */

// ---------------------------------------------------------------- identifiers
export type SkillId = string;
export type ItemId = string;
export type KnowledgeId = string;
export type NpcId = string;
export type EnemyId = string;
export type NodeId = string;
export type LocationId = string;
export type RewriteId = string;
export type WorldTruthId = string;
export type SynergyId = string;
export type EndingId = string;

// ---------------------------------------------------------------- primitives
export type Element = "physical" | "fire" | "lightning" | "holy" | "poison";

export type StatusKind =
  | "burn"
  | "bleed"
  | "poison"
  | "weak"
  | "vulnerable"
  | "fear"
  | "mark";

export interface Status {
  kind: StatusKind;
  amount: number;
}

export type Reliability = "rumor" | "uncertain" | "confirmed" | "invalidated";

export type KnowledgeTag =
  | "route"
  | "combat"
  | "social"
  | "schedule"
  | "lore"
  | "truth"
  | "royal"
  | "meta";

// ---------------------------------------------------------------- knowledge
export type KnowledgeEffect =
  | { kind: "unlockSpecialAction"; actionId: string; scope: "boss" | "combat" | "social" }
  | { kind: "elementMultiplier"; target: string; element: Element; mult: number }
  | { kind: "convertEncounter"; nodeTag: string; to: "social" }
  | { kind: "unlockRoute"; from: string; to: string; stepsSaved: number }
  | { kind: "revealNode"; nodeId: NodeId }
  | { kind: "timeCost"; nodeTag: string; delta: number }
  | { kind: "unlockRewrite"; rewriteId: RewriteId }
  | { kind: "itemEffect"; itemId: ItemId; vs: string; effect: "instantKill" }
  | { kind: "enableNegotiation"; enemyTag: string }
  | { kind: "discloseTruth"; truthId: WorldTruthId }
  | { kind: "endingCondition"; endingId: EndingId };

export interface KnowledgeDef {
  id: KnowledgeId;
  title: string;
  description: string;
  /** Reliability granted on first acquisition. */
  baseReliability: Reliability;
  relatedNPCs: NpcId[];
  relatedLocations: LocationId[];
  tags: KnowledgeTag[];
  /** Human-readable preconditions shown in the codex. */
  conditions: string[];
  /** The actual payload: rules, not prose. */
  gameplayEffects: KnowledgeEffect[];
  /** Short line shown in the KNOWLEDGE ACQUIRED card, one per effect. */
  effectLabels: string[];
  synthesizedFrom?: KnowledgeId[];
}

export interface KnowledgeRecord {
  id: KnowledgeId;
  reliability: Reliability;
  discoveredAtRun: number;
  /** why it is no longer true, if invalidated */
  invalidatedBy?: RewriteId;
}

export interface SynthesisRule {
  id: KnowledgeId;
  requires: KnowledgeId[];
}

// ---------------------------------------------------------------- skills
export type PassiveTag =
  | "seeIntentValues"
  | "seeIntentDepth2"
  | "detectFeint"
  | "negotiate"
  | "necromancy"
  | "firstStrikeCrit"
  | "burnOnHit"
  | "poisonOnHit"
  | "guardDouble"
  | "guardCarry"
  | "chronicler"
  | "steal"
  | "oathbreaker"
  | "empath"
  | "secondWind"
  | "royalKnowledge"
  | "dodgeOnce"
  | "martyr"
  | "archivist"
  | "stormcall";

export type SkillEffect =
  | { kind: "damage"; base: number; element: Element; hits?: number }
  | { kind: "status"; status: StatusKind; amount: number; target: "enemy" | "self" }
  | { kind: "guard"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "payHp"; amount: number }
  | { kind: "bonusNextAttack"; amount: number }
  | { kind: "focus"; amount: number };

export interface SkillDef {
  id: SkillId;
  name: string;
  jp: string;
  /** `world` skills also do something outside combat. */
  kind: "combat" | "world" | "both";
  /** Which reward table it can appear in.  See SELF_REVIEW P2. */
  pool: "combat" | "explore" | "both";
  focusCost: number;
  active: boolean;
  target: "enemy" | "allEnemies" | "self" | "none";
  desc: string;
  worldDesc?: string;
  effects: SkillEffect[];
  passives: PassiveTag[];
}

export interface SynergyDef {
  id: SynergyId;
  name: string;
  jp: string;
  requires: [SkillId, SkillId];
  desc: string;
  /** engine-readable flags the synergy turns on */
  grants: SynergyFlag[];
}

export type SynergyFlag =
  | "corpseKnowledgeConfirmed"
  | "alwaysCritOnKnownIntent"
  | "royalNegotiation"
  | "bloodPriceGuard"
  | "detonateStatuses"
  | "silentPoison"
  | "fullRead"
  | "deathConfirmsAll"
  | "critAfterDodge"
  | "corpseLoot"
  | "intentDepth3";

// ---------------------------------------------------------------- items
export interface ItemDef {
  id: ItemId;
  name: string;
  jp: string;
  price: number;
  rarity: "common" | "uncommon" | "rare";
  kind: "consumable" | "relic";
  /** consumable usable during combat without ending the turn */
  quick?: boolean;
  desc: string;
  effects: SkillEffect[];
  tags: string[];
}

// ---------------------------------------------------------------- enemies
export type IntentKind =
  | "attack"
  | "heavy"
  | "defend"
  | "debuff"
  | "special"
  | "feint";

export interface EnemyMove {
  id: string;
  name: string;
  intent: IntentKind;
  /** what it actually does; a `feint` intent displays as something else */
  effects: SkillEffect[];
  /** for feints: what the player is shown instead */
  disguisedAs?: IntentKind;
  weight: number;
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  jp: string;
  hp: number;
  tags: string[]; // humanoid | undead | beast | metal | wet | noble | boss
  resist: Partial<Record<Element, number>>;
  moves: EnemyMove[];
  gold: [number, number];
  xp: number;
}

export interface BossPhaseDef {
  name: string;
  hp: number;
  moves: EnemyMove[];
  tags: string[];
  resist: Partial<Record<Element, number>>;
}

export interface BossDef {
  id: EnemyId;
  name: string;
  jp: string;
  npcId: NpcId;
  phases: BossPhaseDef[];
  /** Knowledge granted when the player LOSES to it (see SELF_REVIEW Q5-3). */
  consolationKnowledge: KnowledgeId;
}

// ---------------------------------------------------------------- npcs
export interface NpcDef {
  id: NpcId;
  name: string;
  jp: string;
  role: string;
  publicGoal: string;
  trueGoal: string;
  personality: string;
  lies: string[];
  /** first run number at which deja vu can begin */
  dejaVuFromRun: number;
  dejaVuLines: string[];
}

export interface WorldTruthDef {
  id: WorldTruthId;
  statement: string;
  revealedBy: KnowledgeId[];
}

// ---------------------------------------------------------------- rewrites
export type RewriteEffect =
  | { kind: "cancelScheduledEvent"; eventId: string }
  | { kind: "npcFlag"; npc: NpcId; flag: string }
  | { kind: "injectNode"; act: number; nodeId: NodeId }
  | { kind: "removeNode"; nodeId: NodeId }
  | { kind: "invalidate"; knowledge: KnowledgeId[] }
  | { kind: "trust"; npc: NpcId; delta: number }
  | { kind: "suspicion"; delta: number }
  | { kind: "distortion"; delta: number }
  | { kind: "swapBoss"; to: EnemyId }
  | { kind: "dangerShift"; region: string; delta: number }
  | { kind: "grantItem"; item: ItemId }
  | { kind: "unlockRoute"; routeId: string }
  | { kind: "allyNextFight" }
  | { kind: "killNpc"; npc: NpcId };

export interface RewriteDef {
  id: RewriteId;
  title: string;
  /** what the player literally says or does */
  utterance: string;
  requires: KnowledgeId[];
  /** requires these to be Confirmed specifically */
  requiresConfirmed?: KnowledgeId[];
  targetNpc: NpcId;
  timeCost: number; // minutes
  /** short, spoiler-free preview shown before committing */
  preview: string[];
  effects: RewriteEffect[];
}

// ---------------------------------------------------------------- map
export type NodeKind =
  | "hub"
  | "combat"
  | "elite"
  | "social"
  | "discovery"
  | "shop"
  | "shrine"
  | "rest"
  | "ashdoor"
  | "boss";

export interface MapNode {
  id: NodeId;
  kind: NodeKind;
  name: string;
  region: string;
  act: number;
  step: number;
  danger: 0 | 1 | 2 | 3;
  timeCost: number; // minutes
  tags: string[];
  /** reward hints shown before entering */
  hints: string[];
  enemyIds?: EnemyId[];
  npcId?: NpcId;
  knowledgeId?: KnowledgeId;
  /** true when the player only sees it because of Knowledge */
  revealedByKnowledge?: KnowledgeId;
  /** encounter converted to social by Knowledge */
  convertedBy?: KnowledgeId;
}

export interface RunMap {
  /** steps[i] = the set of nodes offered at step i */
  steps: MapNode[][];
  bossId: EnemyId;
}

// ---------------------------------------------------------------- state
export interface PlayerState {
  hp: number;
  maxHp: number;
  focus: number;
  maxFocus: number;
  guard: number;
  level: number;
  xp: number;
  gold: number;
  power: number;
  skills: SkillId[];
  items: ItemId[];
  statuses: Status[];
  /** temporary one-use skills granted by Necromancy */
  echoes: SkillId[];
  flags: Record<string, number>;
}

export interface EnemyState {
  uid: string;
  defId: EnemyId;
  name: string;
  hp: number;
  maxHp: number;
  tags: string[];
  resist: Partial<Record<Element, number>>;
  statuses: Status[];
  guard: number;
  moves: EnemyMove[];
  /** boss only */
  phase?: number;
  phasesLeft?: BossPhaseDef[];
}

export interface Intent {
  moveId: string;
  /** what the player is shown */
  shown: IntentKind;
  /** what it really is */
  actual: IntentKind;
  /** only populated when the player can see values */
  revealedDamage?: number;
  revealedName?: string;
  isFeint: boolean;
  detected: boolean;
}

export interface SpecialAction {
  id: string;
  label: string;
  /** Knowledge or synergy that produced it */
  source: string;
  sourceKind: "knowledge" | "synergy" | "skill" | "item";
  reliability?: Reliability;
  desc: string;
}

export interface CombatState {
  enemies: EnemyState[];
  turn: number;
  phase: "player" | "enemy" | "won" | "lost" | "fled" | "resolved";
  intents: Record<string, Intent>;
  specialActions: SpecialAction[];
  isBoss: boolean;
  bossId?: EnemyId;
  log: string[];
  usedSpecials: string[];
  dodgeReady: boolean;
  firstStrikeUsed: boolean;
  allyActive: boolean;
  negotiable: boolean;
}

export interface WorldDelta {
  rewriteId: RewriteId;
  atClock: number;
  effects: RewriteEffect[];
  summary: string;
  narrative?: string;
}

export interface LogEntry {
  clock: number;
  text: string;
  kind: "info" | "combat" | "knowledge" | "rewrite" | "reward" | "danger";
}

export interface RunState {
  runNumber: number;
  seed: string;
  clock: number; // minutes since midnight; starts at 360 (06:00)
  player: PlayerState;
  map: RunMap;
  step: number; // index into map.steps
  currentNodeId: NodeId | null;
  visited: NodeId[];
  npcTrust: Record<NpcId, number>;
  npcFlags: Record<string, string[]>;
  deadNpcs: NpcId[];
  suspicion: number;
  activeSynergies: SynergyId[];
  worldDeltas: WorldDelta[];
  knowledgeGainedThisRun: KnowledgeId[];
  synthesizedThisRun: KnowledgeId[];
  firstSeenThisRun: LocationId[];
  combat: CombatState | null;
  pendingReward: RewardOffer | null;
  pendingScene: Scene | null;
  log: LogEntry[];
  outcome: "running" | "dead" | "cleared";
  deathCause?: string;
  bossOverride?: EnemyId;
  regionDanger: Record<string, number>;
  freeActionsLeft: number;
  routeUnlocks: string[];
}

export interface RewardOffer {
  kind: "skill" | "item" | "knowledge";
  skillIds?: SkillId[];
  itemIds?: ItemId[];
  gold?: number;
  /** ⚡ markers: index -> synergy it would complete */
  synergyHints?: Record<number, string>;
}

export interface SceneChoice {
  actionId: string;
  label: string;
  /** shown only with Premonition */
  dangerHint?: "safe" | "risky" | "lethal";
  requiresKnowledge?: KnowledgeId;
  requiresSkill?: SkillId;
  locked?: boolean;
  lockReason?: string;
}

export interface Scene {
  nodeId: NodeId;
  title: string;
  narrative: string;
  speaker?: NpcId;
  dialogue?: string;
  mood?: string;
  choices: SceneChoice[];
  allowFreeAction: boolean;
  foreshadowing?: string | null;
  /** true when narration came from the real LLM rather than the mock */
  aiGenerated?: boolean;
}

export interface MetaState {
  totalRuns: number;
  knowledge: Record<KnowledgeId, KnowledgeRecord>;
  worldTruthDisclosure: Record<WorldTruthId, boolean>;
  distortion: number;
  executedRewrites: RewriteId[];
  unlockedEndings: EndingId[];
  firstSeenLocations: LocationId[];
  bestSynergyEver: string | null;
  npcDejaVu: Record<NpcId, number>;
  unlockedSkillPool: SkillId[];
}

export interface GameState {
  meta: MetaState;
  run: RunState | null;
}

// ---------------------------------------------------------------- run report
export interface RunReport {
  runNumber: number;
  outcome: "dead" | "cleared";
  deathCause?: string;
  epitaph: string;
  newKnowledge: { id: KnowledgeId; title: string; synthesized: boolean; effects: string[] }[];
  firstSeen: string[];
  bossesDefeated: string[];
  relationshipsLearned: string[];
  historyRewritten: string[];
  bestSynergy: string | null;
  /** the whole point of the screen */
  nextRunUnlocks: string[];
  rewriteButtonLabel: string;
  endingReached?: EndingId;
}
