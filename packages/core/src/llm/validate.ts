import type {
  NarrativeResponse, InterpretResponse, ReactionResponse, ConsequenceResponse,
  InterpretVerb,
} from "./provider.js";

/**
 * Hand-rolled structural validation (no runtime deps).  Anything that fails
 * here is discarded and the caller falls back to the deterministic mock —
 * DESIGN §17.1, layer 3.
 */

export class SchemaError extends Error {}

const VERBS: InterpretVerb[] = [
  "attack", "talk", "persuade", "deceive", "steal", "use",
  "move", "observe", "give", "destroy", "hide", "other",
];
const MOODS = ["calm", "angry", "afraid", "amused", "suspicious", "broken"] as const;
const MAGS = ["low", "mid", "high"] as const;

function str(v: unknown, max: number, field: string): string {
  if (typeof v !== "string") throw new SchemaError(`${field}: expected string`);
  const t = v.trim();
  if (t.length === 0) throw new SchemaError(`${field}: empty`);
  return t.length > max ? t.slice(0, max) : t;
}

/** Hard clamp to 2 sentences — the tempo rule from DESIGN §20 as code. */
function twoSentences(s: string): string {
  const parts = s.split(/(?<=[。．.!?！？])/).filter((x) => x.trim().length > 0);
  return parts.slice(0, 2).join("").trim();
}

export function parseJson(raw: string): unknown {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new SchemaError("no JSON object found");
  return JSON.parse(body.slice(start, end + 1));
}

export function validateNarrative(v: unknown): NarrativeResponse {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new SchemaError("narrative: not an object");
  const narrative = twoSentences(str(o["narrative"], 160, "narrative"));
  if (!narrative) throw new SchemaError("narrative: empty after clamp");
  let foreshadowing: string | null = null;
  if (typeof o["foreshadowing"] === "string" && o["foreshadowing"].trim()) {
    foreshadowing = str(o["foreshadowing"], 60, "foreshadowing");
  }
  return { narrative, foreshadowing };
}

export function validateInterpret(
  v: unknown,
  knownTargets: string[],
  knownInstruments: string[],
  knownKnowledge: string[],
): InterpretResponse {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new SchemaError("interpret: not an object");
  const verb = o["verb"];
  if (typeof verb !== "string" || !VERBS.includes(verb as InterpretVerb)) {
    throw new SchemaError("interpret: bad verb");
  }
  // Entity resolution: anything the engine does not recognise becomes null.
  const target = typeof o["target"] === "string" && knownTargets.includes(o["target"]) ? o["target"] : null;
  const instrument = typeof o["instrument"] === "string" && knownInstruments.includes(o["instrument"]) ? o["instrument"] : null;
  const usesKnowledge = Array.isArray(o["usesKnowledge"])
    ? (o["usesKnowledge"] as unknown[]).filter((k): k is string => typeof k === "string" && knownKnowledge.includes(k)).slice(0, 4)
    : [];
  const intentSummary = str(o["intentSummary"] ?? "何かをしようとしている", 60, "intentSummary");
  let confidence = typeof o["confidence"] === "number" ? o["confidence"] : 0.5;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  return { verb: verb as InterpretVerb, target, instrument, usesKnowledge, intentSummary, confidence };
}

export function validateReaction(v: unknown, allowedActionIds: string[]): ReactionResponse {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new SchemaError("reaction: not an object");
  const dialogue = str(o["dialogue"], 120, "dialogue");
  const mood = typeof o["mood"] === "string" && (MOODS as readonly string[]).includes(o["mood"])
    ? (o["mood"] as ReactionResponse["mood"]) : "calm";
  const rawChoices = Array.isArray(o["choices"]) ? o["choices"] : [];
  const choices: ReactionResponse["choices"] = [];
  for (const c of rawChoices) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;
    const actionId = cc["actionId"];
    // The model may only relabel actions the engine already offers.
    if (typeof actionId !== "string" || !allowedActionIds.includes(actionId)) continue;
    if (choices.some((x) => x.actionId === actionId)) continue;
    try { choices.push({ actionId, label: str(cc["label"], 28, "label") }); } catch { /* skip */ }
    if (choices.length >= 4) break;
  }
  return { dialogue, mood, choices };
}

export function validateConsequence(v: unknown, allowedPrimitiveIds: string[]): ConsequenceResponse {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new SchemaError("consequence: not an object");
  const rawPicks = Array.isArray(o["picks"]) ? o["picks"] : [];
  const picks: ConsequenceResponse["picks"] = [];
  for (const p of rawPicks) {
    if (!p || typeof p !== "object") continue;
    const pp = p as Record<string, unknown>;
    const id = pp["primitiveId"];
    if (typeof id !== "string" || !allowedPrimitiveIds.includes(id)) continue;
    if (picks.some((x) => x.primitiveId === id)) continue;
    const mag = typeof pp["magnitude"] === "string" && (MAGS as readonly string[]).includes(pp["magnitude"])
      ? (pp["magnitude"] as "low" | "mid" | "high") : "low";
    picks.push({ primitiveId: id, magnitude: mag });
    if (picks.length >= 3) break;
  }
  const narrative = twoSentences(str(o["narrative"] ?? "……", 160, "narrative"));
  return { picks, narrative };
}

/** JSON Schema documents, used for the API request and for documentation. */
export const SCHEMAS = {
  narrative: {
    type: "object", additionalProperties: false,
    required: ["narrative"],
    properties: {
      narrative: { type: "string", maxLength: 160, description: "2 文以内の状況描写" },
      foreshadowing: { type: ["string", "null"], maxLength: 60 },
    },
  },
  interpret: {
    type: "object", additionalProperties: false,
    required: ["verb", "intentSummary"],
    properties: {
      verb: { type: "string", enum: VERBS },
      target: { type: ["string", "null"] },
      instrument: { type: ["string", "null"] },
      usesKnowledge: { type: "array", items: { type: "string" }, maxItems: 4 },
      intentSummary: { type: "string", maxLength: 60 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
  reaction: {
    type: "object", additionalProperties: false,
    required: ["dialogue", "mood"],
    properties: {
      dialogue: { type: "string", maxLength: 120 },
      mood: { type: "string", enum: MOODS },
      choices: {
        type: "array", maxItems: 4,
        items: {
          type: "object", additionalProperties: false,
          required: ["actionId", "label"],
          properties: { actionId: { type: "string" }, label: { type: "string", maxLength: 28 } },
        },
      },
    },
  },
  consequence: {
    type: "object", additionalProperties: false,
    required: ["picks", "narrative"],
    properties: {
      picks: {
        type: "array", maxItems: 3,
        items: {
          type: "object", additionalProperties: false,
          required: ["primitiveId", "magnitude"],
          properties: { primitiveId: { type: "string" }, magnitude: { type: "string", enum: MAGS } },
        },
      },
      narrative: { type: "string", maxLength: 160 },
    },
  },
} as const;
