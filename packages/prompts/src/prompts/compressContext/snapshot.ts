import {
  COMPRESSION_SNAPSHOT_SCHEMA_VERSION,
  type CompressionSnapshotV2,
  CompressionSnapshotV2Schema,
  type ContextConstraint,
  type ContextDecision,
  type ContextOpenItem,
  type ContextTechnicalFact,
} from '@lobechat/types';

export type CompressMessageInput = {
  content?: string | null;
  id?: string;
  role?: string;
};

export type ChainCompressContextInput = {
  existingSnapshot?: CompressionSnapshotV2 | null;
  legacySummary?: string | null;
  /** Messages to fold into the checkpoint (include messageId when available). */
  messages: CompressMessageInput[];
  /** Soft target for rendered summary tokens (used only as prompt guidance). */
  maxSummaryTokens?: number;
};

export type CompressContextResult = {
  snapshot: CompressionSnapshotV2;
  /** Markdown rendered for UI + model history injection. */
  content: string;
  /** Constraints repaired/restored by code (model omitted prior hard constraints). */
  repaired: boolean;
  newConstraintCount: number;
  supersededConstraintCount: number;
  activeHardConstraintCount: number;
  /** Snapshot fields were trimmed to fit maxSummaryTokens. */
  budgetTrimmed?: boolean;
};

const clampMaxSummaryTokens = (value?: number) => {
  if (!value || !Number.isFinite(value)) return 2048;
  return Math.min(8192, Math.max(1024, Math.floor(value)));
};

/**
 * Extract a JSON object from model output (raw JSON or fenced ```json block).
 */
export const extractJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('empty_compression_output');

  let candidate = trimmed;
  const fenceOpen = trimmed.match(/^```(?:json)?[ \t]*\r?\n?/i);
  if (fenceOpen) {
    const afterOpen = trimmed.slice(fenceOpen[0].length);
    const closeIdx = afterOpen.lastIndexOf('```');
    candidate = (closeIdx >= 0 ? afterOpen.slice(0, closeIdx) : afterOpen).trim();
  }

  // Prefer first {...} span if there is leading prose
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('compression_output_not_json');
  }

  return JSON.parse(candidate.slice(start, end + 1));
};

export const parseCompressionSnapshot = (raw: string): CompressionSnapshotV2 => {
  const parsed = extractJsonObject(raw);
  // Do not override schemaVersion — reject non-v2 payloads strictly
  const result = CompressionSnapshotV2Schema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`compression_snapshot_invalid: ${result.error.message}`);
  }

  return result.data;
};

const isValidSourceId = (id: string | undefined, validIds: Set<string>) =>
  Boolean(id && validIds.has(id));

export type UserMessageEvidence = {
  content: string;
  id: string;
};

export type InheritConstraintsOptions = {
  /**
   * Message ids from the CURRENT batch that may authorize NEW active constraints
   * or supersedes. Must be user-role messages only — never tool/assistant/web.
   */
  currentUserMessageIds: Set<string>;
  /**
   * Historical source ids allowed only when re-emitting an already-known constraint
   * (inheritance). Cannot authorize new hard constraints or supersedes.
   */
  inheritedSourceIds?: Set<string>;
  /**
   * Current-batch user message bodies keyed by id. New hard constraints must have
   * their text evidenced in the cited user message (not only a valid id).
   */
  userMessageEvidence?: Map<string, string>;
};

const normalizeEvidence = (text: string): string =>
  text.replaceAll(/\s+/g, ' ').trim().toLowerCase();

/** True when constraint text appears in the cited user message body. */
export const constraintTextEvidencedInUserMessage = (
  constraintText: string,
  userContent: string | undefined,
): boolean => {
  if (!userContent) return false;
  const needle = normalizeEvidence(constraintText);
  const haystack = normalizeEvidence(userContent);
  if (needle.length < 2) return false;
  return haystack.includes(needle);
};

/**
 * Enforce constraint fidelity:
 * - Prior active hard constraints must remain unless explicitly superseded by a
 *   current-user message (valid source in currentUserMessageIds).
 * - New active constraints require a current-user sourceMessageId.
 * - Historical source ids only allow re-emitting prior constraints (inheritance).
 * - Illegal supersede is rejected (keep old active).
 */
export const inheritConstraints = (
  previous: ContextConstraint[] | undefined,
  next: ContextConstraint[],
  validSourceIdsOrOptions: Set<string> | InheritConstraintsOptions,
): {
  constraints: ContextConstraint[];
  repaired: boolean;
  newCount: number;
  supersededCount: number;
} => {
  // Back-compat: plain Set treated as current-user sources only (strict).
  const options: InheritConstraintsOptions =
    validSourceIdsOrOptions instanceof Set
      ? { currentUserMessageIds: validSourceIdsOrOptions }
      : validSourceIdsOrOptions;

  const currentUserIds = options.currentUserMessageIds;
  const evidence = options.userMessageEvidence;
  const priorActiveHard = (previous ?? []).filter(
    (c) => c.strength === 'hard' && c.status === 'active',
  );
  const priorById = new Map((previous ?? []).map((c) => [c.id, c]));

  const hasUserEvidence = (c: ContextConstraint) => {
    if (!evidence || evidence.size === 0) {
      // No evidence map supplied (legacy callers) — id-only check remains
      return true;
    }
    if (!c.sourceMessageId) return false;
    return constraintTextEvidencedInUserMessage(c.text, evidence.get(c.sourceMessageId));
  };

  const sanitizedNext: ContextConstraint[] = [];
  for (const c of next) {
    const prior = priorById.get(c.id);
    const fromCurrentUser = isValidSourceId(c.sourceMessageId, currentUserIds);

    // Supersede: only current-user messages with textual evidence may retire a constraint
    if (c.supersedes) {
      if (!fromCurrentUser || !hasUserEvidence(c)) {
        // illegal — drop supersede link; if this is a re-emit of prior, keep prior shape
        if (prior) {
          sanitizedNext.push({
            ...prior,
            status: prior.status,
            supersededBy: undefined,
            supersedes: undefined,
          });
        }
        continue;
      }
      sanitizedNext.push(c);
      continue;
    }

    if (c.status === 'active') {
      if (fromCurrentUser && hasUserEvidence(c)) {
        sanitizedNext.push(c);
        continue;
      }
      // Inheritance re-emit of a known constraint (any prior source ok for identity)
      if (prior) {
        sanitizedNext.push({
          ...c,
          sourceMessageId: c.sourceMessageId ?? prior.sourceMessageId,
          text: prior.strength === 'hard' ? prior.text : c.text,
          strength: prior.strength === 'hard' ? 'hard' : c.strength,
          status: prior.status === 'superseded' ? 'superseded' : 'active',
        });
        continue;
      }
      // Brand-new active without current-user source + evidence — drop
      continue;
    }

    // superseded rows without supersedes link: keep only if known prior
    if (prior) {
      sanitizedNext.push({
        ...c,
        text: prior.strength === 'hard' ? prior.text : c.text,
        strength: prior.strength === 'hard' ? 'hard' : c.strength,
        sourceMessageId: c.sourceMessageId ?? prior.sourceMessageId,
      });
    }
  }

  const isLegalSupersede = (c: ContextConstraint) =>
    Boolean(c.supersedes) &&
    isValidSourceId(c.sourceMessageId, currentUserIds) &&
    hasUserEvidence(c);

  const nextById = new Map(sanitizedNext.map((c) => [c.id, c]));
  const supersededTargets = new Set(
    sanitizedNext
      .filter((c) => isLegalSupersede(c))
      .map((c) => c.supersedes)
      .filter((id): id is string => Boolean(id)),
  );

  let repaired = false;
  let supersededCount = 0;

  for (const c of sanitizedNext) {
    if (!isLegalSupersede(c)) continue;
    const target =
      nextById.get(c.supersedes) ?? (previous ?? []).find((p) => p.id === c.supersedes);
    if (!target) continue;
    if (target.status !== 'superseded') {
      const updated: ContextConstraint = {
        ...target,
        status: 'superseded',
        supersededBy: c.id,
      };
      nextById.set(updated.id, updated);
      if (!sanitizedNext.some((x) => x.id === updated.id)) {
        sanitizedNext.push(updated);
      } else {
        const idx = sanitizedNext.findIndex((x) => x.id === updated.id);
        if (idx >= 0) sanitizedNext[idx] = updated;
      }
      supersededCount++;
    }
  }

  for (const prior of priorActiveHard) {
    if (supersededTargets.has(prior.id)) continue;
    const existing = nextById.get(prior.id);
    if (!existing) {
      sanitizedNext.push({ ...prior, status: 'active' });
      nextById.set(prior.id, prior);
      repaired = true;
      continue;
    }
    const superseding = sanitizedNext.find((c) => c.supersedes === prior.id);
    if (
      existing.status === 'superseded' &&
      !isValidSourceId(superseding?.sourceMessageId, currentUserIds)
    ) {
      const restored = { ...prior, status: 'active' as const, supersededBy: undefined };
      const idx = sanitizedNext.findIndex((x) => x.id === prior.id);
      if (idx >= 0) sanitizedNext[idx] = restored;
      nextById.set(prior.id, restored);
      repaired = true;
    } else if (existing.strength !== 'hard' || existing.text !== prior.text) {
      const restored: ContextConstraint = {
        ...existing,
        strength: 'hard',
        text: prior.text,
        status:
          existing.status === 'superseded' && supersededTargets.has(prior.id)
            ? 'superseded'
            : 'active',
        sourceMessageId: existing.sourceMessageId ?? prior.sourceMessageId,
      };
      const idx = sanitizedNext.findIndex((x) => x.id === prior.id);
      if (idx >= 0) sanitizedNext[idx] = restored;
      nextById.set(prior.id, restored);
      repaired = true;
    }
  }

  const priorIds = new Set((previous ?? []).map((c) => c.id));
  const newCount = sanitizedNext.filter((c) => !priorIds.has(c.id) && c.status === 'active').length;

  return { constraints: sanitizedNext, repaired, newCount, supersededCount };
};

export const renderCompressionMarkdown = (snapshot: CompressionSnapshotV2): string => {
  const sections: string[] = [];

  if (snapshot.overview?.trim()) {
    sections.push(`### Context\n${snapshot.overview.trim()}`);
  }

  const activeHard = snapshot.constraints.filter(
    (c) => c.status === 'active' && c.strength === 'hard',
  );
  const activeSoft = snapshot.constraints.filter(
    (c) => c.status === 'active' && c.strength === 'soft',
  );

  if (activeHard.length > 0 || activeSoft.length > 0) {
    const lines: string[] = [];
    for (const c of activeHard) lines.push(`- [HARD] ${c.text}`);
    for (const c of activeSoft) lines.push(`- [soft] ${c.text}`);
    sections.push(`### Constraints\n${lines.join('\n')}`);
  }

  if (snapshot.decisions.length > 0) {
    sections.push(
      `### Decisions & Conclusions\n${snapshot.decisions.map((d) => `- ${d.text}`).join('\n')}`,
    );
  }

  if (snapshot.openItems.length > 0) {
    sections.push(
      `### Action Items\n${snapshot.openItems
        .map((i) => `- ${i.blocked ? '[blocked] ' : ''}${i.text}`)
        .join('\n')}`,
    );
  }

  if (snapshot.technicalFacts.length > 0) {
    sections.push(
      `### Key Information\n${snapshot.technicalFacts
        .map((f) => `- ${f.kind ? `(${f.kind}) ` : ''}${f.text}`)
        .join('\n')}`,
    );
  }

  return sections.join('\n\n').trim();
};

/** Cheap token estimate (~chars/4) — enough for budget gates without tokenx. */
export const estimateSummaryTokens = (text: string): number =>
  Math.max(1, Math.ceil((text || '').length / 4));

/**
 * Trim snapshot to fit maxSummaryTokens while never dropping active hard constraints.
 * Order: overview → soft constraints → technicalFacts → openItems → decisions.
 */
export const trimSnapshotToBudget = (
  snapshot: CompressionSnapshotV2,
  maxSummaryTokens?: number,
): { snapshot: CompressionSnapshotV2; trimmed: boolean } => {
  const budget = clampMaxSummaryTokens(maxSummaryTokens);
  if (estimateSummaryTokens(renderCompressionMarkdown(snapshot)) <= budget) {
    return { snapshot, trimmed: false };
  }

  const next: CompressionSnapshotV2 = {
    ...snapshot,
    overview: snapshot.overview,
    constraints: [...snapshot.constraints],
    decisions: [...snapshot.decisions],
    openItems: [...snapshot.openItems],
    technicalFacts: [...snapshot.technicalFacts],
  };

  const over = () => estimateSummaryTokens(renderCompressionMarkdown(next)) > budget;

  // 1. Shrink overview first
  if (over() && next.overview) {
    const maxChars = Math.max(80, budget * 2);
    next.overview =
      next.overview.length > maxChars
        ? `${next.overview.slice(0, maxChars).trimEnd()}…`
        : next.overview;
    if (over())
      next.overview = next.overview.slice(0, Math.max(40, Math.floor(budget))).trimEnd() + '…';
    if (over()) next.overview = '';
  }

  // 2. Drop soft constraints (keep hard)
  if (over()) {
    next.constraints = next.constraints.filter(
      (c) => !(c.status === 'active' && c.strength === 'soft'),
    );
  }

  // 3. Drop technical facts from the end (ordinary details first)
  while (over() && next.technicalFacts.length > 0) {
    next.technicalFacts.pop();
  }

  // 4. Drop open items from the end
  while (over() && next.openItems.length > 0) {
    next.openItems.pop();
  }

  // 5. Drop decisions from the end (last resort among non-hard fields)
  while (over() && next.decisions.length > 0) {
    next.decisions.pop();
  }

  // Active hard constraints are never removed.
  return { snapshot: next, trimmed: true };
};

const formatLegacySummaryForPrompt = (summary: string): string =>
  // Pure JSON block — no XML wrapper that content can break out of
  JSON.stringify({ type: 'legacy_summary', text: summary.trim() }, null, 2);

const formatMessagesForPrompt = (messages: CompressMessageInput[]): string => {
  // Pure JSON data block (no XML shell) so message content cannot close tags early
  const payload = {
    type: 'messages_to_merge',
    messages: messages.map((m) => ({
      content: typeof m.content === 'string' ? m.content : '',
      id: m.id ?? null,
      role: m.role || 'unknown',
    })),
  };
  return JSON.stringify(payload, null, 2);
};

export const buildCompressContextSystemPrompt = (maxSummaryTokens?: number): string => {
  const budget = clampMaxSummaryTokens(maxSummaryTokens);
  return `You are a conversation context compressor. Merge prior context and new messages into ONE structured JSON checkpoint (CompressionSnapshotV2).

## Output
Return ONLY a single JSON object (no markdown fences, no commentary) with this shape:
{
  "schemaVersion": 2,
  "overview": "1-2 sentence background",
  "constraints": [
    {
      "id": "stable-id",
      "text": "verbatim constraint text",
      "strength": "hard" | "soft",
      "status": "active" | "superseded",
      "sourceMessageId": "message id that introduced or last confirmed it",
      "supersedes": "optional prior constraint id this replaces",
      "supersededBy": "optional"
    }
  ],
  "decisions": [{ "id": "...", "text": "...", "sourceMessageId": "...", "confirmed": true }],
  "openItems": [{ "id": "...", "text": "...", "blocked": false, "sourceMessageId": "..." }],
  "technicalFacts": [{ "id": "...", "text": "...", "kind": "code|path|command|asin|site|date|file|url|other", "sourceMessageId": "..." }],
  "sourceGroupIds": []
}

## Constraint fidelity (MUST)
- Preserve every prior ACTIVE HARD constraint verbatim unless the NEW messages explicitly negate or modify it.
- To supersede a hard constraint you MUST set supersedes to its id AND provide a valid sourceMessageId from the new messages that states the change.
- Soft preferences may be updated more freely but still need a sourceMessageId when newly active.
- Never invent constraints, decisions, IDs, ASINs, paths, commands, dates, or URLs.
- New active constraints without a real sourceMessageId from the provided messages are forbidden.

## Content rules
- Output language MUST match the conversation language.
- Preserve technical identifiers exactly (code, paths, commands, ASINs, sites, dates, files, URLs).
- Prefer consolidation over repetition; drop greetings and filler.
- Target roughly <= ${budget} tokens of useful content across fields (overview is first to trim if over budget).
- sourceGroupIds: copy from existing snapshot and leave group-id merging to the system (you may pass through existing sourceGroupIds).

## Priority when resolving conflicts
1. Latest explicit user instruction in the new messages
2. Active hard constraints
3. Confirmed decisions
4. Open items / technical facts
5. Overview background`;
};

export const buildCompressContextUserPrompt = (input: ChainCompressContextInput): string => {
  const parts: string[] = [];

  if (input.existingSnapshot) {
    parts.push(
      JSON.stringify({ type: 'existing_snapshot', snapshot: input.existingSnapshot }, null, 2),
    );
  } else if (input.legacySummary?.trim()) {
    parts.push(formatLegacySummaryForPrompt(input.legacySummary));
  } else {
    parts.push(JSON.stringify({ type: 'existing_snapshot', snapshot: null }));
  }

  parts.push(formatMessagesForPrompt(input.messages));
  parts.push(
    'Merge the existing_snapshot/legacy_summary JSON block with the messages_to_merge JSON block into one CompressionSnapshotV2 JSON object. Output ONLY the JSON object.',
  );

  return parts.join('\n\n');
};

/**
 * Build a validated snapshot from model raw output + prior snapshot.
 * Applies constraint inheritance repair.
 */
export const buildValidatedCompressionResult = (params: {
  raw: string;
  previousSnapshot?: CompressionSnapshotV2 | null;
  /**
   * @deprecated Prefer currentUserMessageIds. When only messageIds is set,
   * treated as current-user sources (strict — no historical forgery).
   */
  messageIds?: string[];
  /** User-role message ids from THIS compression batch only. */
  currentUserMessageIds?: string[];
  /** Current-batch user message bodies for evidence checks. */
  userMessages?: UserMessageEvidence[];
  sourceGroupIds?: string[];
  maxSummaryTokens?: number;
}): CompressContextResult => {
  const parsed = parseCompressionSnapshot(params.raw);
  const userMessageEvidence = new Map(
    (params.userMessages ?? []).filter((m) => m.id).map((m) => [m.id, m.content ?? '']),
  );
  const currentUserMessageIds = new Set(
    (params.currentUserMessageIds ?? params.messageIds ?? [...userMessageEvidence.keys()]).filter(
      Boolean,
    ),
  );
  const inheritedSourceIds = new Set<string>();
  for (const c of params.previousSnapshot?.constraints ?? []) {
    if (c.sourceMessageId) inheritedSourceIds.add(c.sourceMessageId);
  }

  const inherited = inheritConstraints(params.previousSnapshot?.constraints, parsed.constraints, {
    currentUserMessageIds,
    inheritedSourceIds,
    userMessageEvidence,
  });

  const sourceGroupIds = Array.from(
    new Set([
      ...(params.previousSnapshot?.sourceGroupIds ?? []),
      ...(parsed.sourceGroupIds ?? []),
      ...(params.sourceGroupIds ?? []),
    ]),
  );

  const built: CompressionSnapshotV2 = {
    schemaVersion: COMPRESSION_SNAPSHOT_SCHEMA_VERSION,
    overview: parsed.overview ?? '',
    constraints: inherited.constraints,
    decisions: parsed.decisions ?? [],
    openItems: parsed.openItems ?? [],
    technicalFacts: parsed.technicalFacts ?? [],
    sourceGroupIds,
  };

  const { snapshot, trimmed } = trimSnapshotToBudget(built, params.maxSummaryTokens);

  return {
    snapshot,
    content: renderCompressionMarkdown(snapshot),
    repaired: inherited.repaired,
    newConstraintCount: inherited.newCount,
    supersededConstraintCount: inherited.supersededCount,
    activeHardConstraintCount: snapshot.constraints.filter(
      (c) => c.status === 'active' && c.strength === 'hard',
    ).length,
    budgetTrimmed: trimmed,
  };
};

/** Try to read a V2 snapshot from group metadata (or nested). */
export const readSnapshotFromMetadata = (metadata: unknown): CompressionSnapshotV2 | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as Record<string, unknown>;
  const candidate = meta.snapshot ?? meta;
  if (!candidate || typeof candidate !== 'object') return null;
  const result = CompressionSnapshotV2Schema.safeParse(candidate);
  return result.success ? result.data : null;
};

export type {
  CompressionSnapshotV2,
  ContextConstraint,
  ContextDecision,
  ContextOpenItem,
  ContextTechnicalFact,
};
