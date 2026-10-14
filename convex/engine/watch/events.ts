/**
 * WATCH LOGIC: what happened, how important is it, is it new, and who should hear about it?
 * Plain code decides all of this. AI is only allowed to write a short summary afterwards.
 */
import { AUTHORITY_SCORE, WATCH } from "../../config/engine.ts";
import type { AuthorityTier, EventType } from "../enums.ts";
import { fastHash, normalizeText, normalizeTitle, similarity } from "../lib/text.ts";

// ---------------------------------------------------------------------------
// 1. What kind of event is it? (rules first)
// ---------------------------------------------------------------------------

const RULES: Array<{ type: EventType; pattern: RegExp }> = [
  { type: "results", pattern: /\b(q[1-4]\s?(fy)?\d{0,4}\s?(results?|earnings)|quarterly results?|net profit|financial results?|earnings (report|call)|revenue (rises|falls|jumps|declines|grows)|profit (rises|falls|jumps|declines|surges|slumps))\b/i },
  { type: "merger_acquisition", pattern: /\b(acquire[sd]?|acquisition|merger|merges?|takeover|buyout|stake sale|buys? .{0,30}stake|demerger|amalgamation|tender offer|(raises?|sweetens?|revises?|hikes?) .{0,25}offer|offer (for|to buy)|joint venture|partnership|pact|strategic alliance|tie-?up|join(s|ed)? hands|team(s|ed)? up|collaborat\w*)\b/i },
  { type: "regulatory_legal", pattern: /\b(sebi|rbi|cci|nclt|ed\b|enforcement directorate|show[- ]cause|penalty|fined?|probe|lawsuit|court|investigation|fraud|raid|notice from)\b/i },
  { type: "rating_change", pattern: /\b(upgrade[sd]?|downgrade[sd]?|rating|target price|crisil|icra|care ratings|moody'?s|fitch|s&p)\b/i },
  { type: "management_change", pattern: /\b(resign(s|ed|ation)?|appoint(s|ed|ment)?|steps? down|new (ceo|cfo|md|chairman)|ceo|cfo)\b/i },
  { type: "dividend_corporate_action", pattern: /\b(dividend|bonus issue|stock split|share split|buyback|rights issue|record date|ex[- ]date)\b/i },
  { type: "board_meeting", pattern: /\b(board meeting|agm|egm|general meeting)\b/i },
  { type: "guidance", pattern: /\b(guidance|outlook|forecast|expects?|projects?|to (grow|double)|targets?)\b/i },
  { type: "large_price_move", pattern: /\b(shares? (surge|jump|soar|plunge|tumble|crash|rally|slump)|stock (surges?|jumps?|plunges?|tanks?|rallies)|hits? (52[- ]week|all[- ]time|\d+[- ]month) (high|low)|upper circuit|lower circuit)\b/i },
];

export interface Classification {
  type: EventType;
  /** "rule" = a rule matched clearly. "ambiguous" = several rules matched, or none; ask the AI to pick from the fixed list. */
  basis: "rule" | "ambiguous";
  matched: EventType[];
}

export function classifyEvent(title: string, body = ""): Classification {
  const text = `${title}. ${body}`;
  const matched = RULES.filter((r) => r.pattern.test(text)).map((r) => r.type);
  if (matched.length === 1) return { type: matched[0]!, basis: "rule", matched };
  if (matched.length === 0) return { type: "other", basis: "ambiguous", matched };
  // Several matches: if the headline alone matches only one, trust that one.
  const inTitle = RULES.filter((r) => r.pattern.test(title)).map((r) => r.type);
  if (inTitle.length === 1) return { type: inTitle[0]!, basis: "rule", matched };
  return { type: matched[0]!, basis: "ambiguous", matched };
}

// ---------------------------------------------------------------------------
// 2. How important is it? (0 to 100)
// ---------------------------------------------------------------------------

export function importanceScore(i: {
  type: EventType;
  authorityTier: AuthorityTier;
  publishedAt?: number;
  now: number;
  /** false when this is just another report of a story we already alerted about. */
  isNewStory: boolean;
}): number {
  const typeWeight = WATCH.eventTypeWeight[i.type];
  const authority = 0.6 + 0.4 * AUTHORITY_SCORE[i.authorityTier]; // official sources lift the score, but never zero it
  const ageHours = i.publishedAt === undefined ? 12 : Math.max(0, (i.now - i.publishedAt) / 3_600_000);
  const freshness = 0.5 ** (ageHours / 36); // half as important every 36 hours
  const novelty = i.isNewStory ? 1 : 0.4;
  return Math.round(Math.min(100, typeWeight * authority * (0.5 + 0.5 * freshness) * novelty));
}

// ---------------------------------------------------------------------------
// 3. Is it a duplicate? Three levels, cheapest first.
// ---------------------------------------------------------------------------

export interface ExistingEvent {
  clusterKey: string;
  entityId: string;
  title: string;
  titleHash: string;
  firstSeenAt: number;
}

export interface IncomingItem {
  entityId: string;
  title: string;
  publishedAt: number;
}

export type DedupeDecision =
  | { action: "new"; clusterKey: string; titleHash: string }
  | { action: "merge"; clusterKey: string; titleHash: string; level: "title" | "similar"; similarity: number };

export function titleHashOf(title: string): string {
  return fastHash(normalizeTitle(title));
}

/**
 * Level 1 (exact URL) is handled before this, when the source is saved.
 * Level 2: same normalized headline, same company, within the window.
 * Level 3: very similar wording, same company, within the window.
 */
export function dedupe(item: IncomingItem, existing: ExistingEvent[]): DedupeDecision {
  const titleHash = titleHashOf(item.title);
  const candidates = existing.filter(
    (e) => e.entityId === item.entityId && Math.abs(item.publishedAt - e.firstSeenAt) <= WATCH.dedupeWindowMs,
  );
  const exact = candidates.find((e) => e.titleHash === titleHash);
  if (exact) return { action: "merge", clusterKey: exact.clusterKey, titleHash, level: "title", similarity: 1 };

  let best: { e: ExistingEvent; sim: number } | undefined;
  for (const e of candidates) {
    const sim = similarity(normalizeTitle(item.title), normalizeTitle(e.title));
    if (sim >= WATCH.nearDuplicateSimilarity && (!best || sim > best.sim)) best = { e, sim };
  }
  if (best) return { action: "merge", clusterKey: best.e.clusterKey, titleHash, level: "similar", similarity: best.sim };

  return { action: "new", clusterKey: `${item.entityId}:${titleHash}`, titleHash };
}

// ---------------------------------------------------------------------------
// 4. Who gets told, and how?
// ---------------------------------------------------------------------------

export interface SubscriptionRules {
  minImportance: number;
  eventTypes: EventType[]; // empty = all types
  emailImmediate: boolean;
  emailDigest: boolean;
}

export type AlertPlan =
  | { send: false; reason: string }
  | { send: true; channels: Array<"in_app" | "email_immediate" | "email_digest"> };

export function planAlert(
  event: { type: EventType; importance: number },
  rules: SubscriptionRules,
  immediateSentLastHour: number,
): AlertPlan {
  if (event.importance < rules.minImportance) return { send: false, reason: "Below the user's importance threshold." };
  if (rules.eventTypes.length > 0 && !rules.eventTypes.includes(event.type)) return { send: false, reason: "Event type not selected by the user." };

  const channels: Array<"in_app" | "email_immediate" | "email_digest"> = ["in_app"];
  const wantsImmediate = rules.emailImmediate && event.importance >= WATCH.immediateEmailMinImportance;
  if (wantsImmediate && immediateSentLastHour < WATCH.maxImmediateEmailsPerHour) channels.push("email_immediate");
  else if (rules.emailDigest || wantsImmediate) channels.push("email_digest"); // over the hourly cap: fall back to the digest
  return { send: true, channels };
}

/** One alert per (user, event, channel). The same key twice means "already sent". */
export function alertKey(userId: string, eventId: string, channel: string): string {
  return `${userId}:${eventId}:${channel}`;
}

/**
 * A story we already alerted about may be alerted again only if it became MORE important in a meaningful way,
 * e.g. a rumour turned into an official confirmation (crossing the immediate-email threshold).
 */
export function shouldRealert(previousImportance: number, newImportance: number): boolean {
  const t = WATCH.immediateEmailMinImportance;
  return previousImportance < t && newImportance >= t;
}

export { normalizeText };
