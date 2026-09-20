/**
 * LLM boundary.
 *
 * Note what is NOT in any response type below: hp, damage, gold, time, item
 * grants, success flags.  The schema physically cannot carry a number that
 * matters (DESIGN §17.1, layer 1).
 */

export interface WorldContextTruth { id: string; statement: string; revealed: boolean; }

export interface WorldContextNpc {
  id: string; name: string; publicGoal: string; trueGoal?: string;
  personality: string; trust: number; dejaVuStage: number; knownLies: string[];
}

export interface WorldContext {
  worldTruths: WorldContextTruth[];
  npc?: WorldContextNpc;
  state: {
    clock: string; location: string; act: number; playerHpPct: number;
    suspicion: number; distortion: number; runNumber: number;
  };
  knowledge: { id: string; title: string; reliability: string }[];
  changedHistory: { rewriteId: string; summary: string }[];
  playerAction?: { raw: string } | { actionId: string };
}

export interface NarrativeRequest { context: WorldContext; beat: string; }
export interface NarrativeResponse { narrative: string; foreshadowing: string | null; }

export type InterpretVerb =
  | "attack" | "talk" | "persuade" | "deceive" | "steal" | "use"
  | "move" | "observe" | "give" | "destroy" | "hide" | "other";

export interface InterpretRequest {
  context: WorldContext;
  raw: string;
  /** entity ids the engine will accept as `target` */
  knownTargets: { id: string; label: string }[];
  knownInstruments: { id: string; label: string }[];
}

export interface InterpretResponse {
  verb: InterpretVerb;
  target: string | null;
  instrument: string | null;
  usesKnowledge: string[];
  intentSummary: string;
  /** the model's own guess; the engine treats it as a hint, never as a ruling */
  confidence: number;
}

export interface ReactionRequest { context: WorldContext; event: string; allowedActionIds: { id: string; hint: string }[]; }
export interface ReactionResponse {
  dialogue: string;
  mood: "calm" | "angry" | "afraid" | "amused" | "suspicious" | "broken";
  choices: { actionId: string; label: string }[];
}

/** The engine hands the model a menu.  The model may only point at it. */
export interface ConsequencePrimitive { id: string; label: string; }
export interface ConsequenceRequest {
  context: WorldContext;
  change: string;
  allowedPrimitives: ConsequencePrimitive[];
}
export interface ConsequenceResponse {
  picks: { primitiveId: string; magnitude: "low" | "mid" | "high" }[];
  narrative: string;
}

export interface LLMProvider {
  readonly name: string;
  generateNarrative(req: NarrativeRequest): Promise<NarrativeResponse>;
  interpretAction(req: InterpretRequest): Promise<InterpretResponse>;
  generateReaction(req: ReactionRequest): Promise<ReactionResponse>;
  proposeConsequences(req: ConsequenceRequest): Promise<ConsequenceResponse>;
}
