/**
 * Optional Plan Mode (session preference on agent chatConfig.planMode).
 * Off by default — same spirit as Codex collaboration mode / Grok /plan:
 * user opts in; while on, clarify + task sheet first, no heavy execution.
 */

export const isPlanModeEnabled = (value?: boolean | null): boolean => value === true;

/**
 * Appended only when planMode is on. Empty string when off so systemRole is unchanged.
 */
export const buildPlanModeInstruction = (enabled?: boolean | null): string => {
  if (!isPlanModeEnabled(enabled)) return '';

  return [
    '## Plan Mode (session preference — HARD)',
    'Mode: **Plan** (`planMode: true`). Stay in this mode until the user turns Plan Mode off in the UI.',
    '',
    '### Rules',
    '1. **Do not fully execute** the user’s request yet (no final HTML reports, no bulk multi-ASIN VOC synthesis deliverables, no dingpan upload of finished reports, no irreversible writes).',
    '2. **Light read-only exploration is allowed** only to reduce ambiguity (lookup listing basics, confirm ASIN existence, read configs). Prefer discovering facts over asking when the tools can answer cheaply.',
    '3. **Clarify missing high-impact slots** before drafting the task sheet: marketplace/site, ASIN(s), time range, analysis goal / deliverable. If a slot would change the answer and cannot be inferred, ask — prefer `lobe-user-interaction` → `askUserQuestion` with meaningful options + a recommended default. Ask only what materially changes the plan.',
    '4. **Reasonable defaults**: if the user left a low-impact field blank (e.g. “近14天”, US site when context implies it), state the default as an assumption instead of blocking.',
    '5. **Output a short 任务单 (task sheet)** in the user language, then **stop and wait** for confirmation. Do not ask “should I proceed?” in a vague way — end with a clear task sheet and wait for explicit confirm (e.g. 确认 / 开始 / 按这个跑) or for the user to turn Plan Mode off and request execution.',
    '6. While Plan Mode is still on, if the user says “go do it” without a clear confirm of the sheet, treat it as a request to **refine the plan**, not silent full execution.',
    '',
    '### 任务单 format (compact)',
    '- **目标**',
    '- **范围**：站点 / ASIN(s) / 时间 / 其他约束',
    '- **交付物**（如中文 HTML 报告 / 列表）',
    '- **假设与默认**',
    '- **待确认项**（if any）',
  ].join('\n');
};

export const withPlanModeInstruction = (
  systemRole: string | undefined | null,
  enabled?: boolean | null,
): string => {
  const block = buildPlanModeInstruction(enabled);
  if (!block) return systemRole?.trim() ?? '';
  const base = systemRole?.trim() ?? '';
  return base ? `${base}\n\n${block}` : block;
};
