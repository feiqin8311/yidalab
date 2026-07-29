import type { HtmlDeliveryMode } from '@lobechat/types';

export const HTML_DELIVERY_MODES = [
  'artifact',
  'dingpan',
  'ask',
] as const satisfies readonly HtmlDeliveryMode[];

/** YidaLab default: shareable DingTalk Drive link (+ in-app preview). */
export const DEFAULT_HTML_DELIVERY_MODE: HtmlDeliveryMode = 'dingpan';

export const isHtmlDeliveryMode = (value: unknown): value is HtmlDeliveryMode =>
  typeof value === 'string' && (HTML_DELIVERY_MODES as readonly string[]).includes(value);

export const resolveHtmlDeliveryMode = (value?: string | null): HtmlDeliveryMode =>
  isHtmlDeliveryMode(value) ? value : DEFAULT_HTML_DELIVERY_MODE;

/**
 * Appended to agent systemRole so the model respects the profile setting.
 * Placed last so it overrides generic “ask the user” skill copy.
 */
export const buildHtmlDeliveryInstruction = (mode?: string | null): string => {
  const resolved = resolveHtmlDeliveryMode(mode);

  if (resolved === 'dingpan') {
    return [
      '## HTML deliverable surface (agent preference — HARD)',
      'Mode: **钉盘链接（可预览）** (`dingpan`) — dual surface: in-app preview card + shareable Drive link',
      '- For HTML / interactive / visual reports: call `lobe-dingpan` → `uploadHtmlToDingpan` with the full HTML.',
      '- After success: reply with the tool `preview_url` (shareable). The product UI shows workspace preview from `document_id` — do **not** also emit `<lobeArtifact type="text/html">` (avoids duplicate HTML in context) unless the user explicitly asks for Artifact tags.',
      '- Do **not** ask the user how to deliver.',
      '- If tool content is empty/error, say upload failed — **never invent** substitute URLs.',
      '- Binary files (xlsx/csv/pdf/…) still use `uploadToDingpan` as usual.',
    ].join('\n');
  }

  if (resolved === 'ask') {
    return [
      '## HTML deliverable surface (agent preference — HARD)',
      'Mode: **可选择** (`ask`)',
      '- If the user has **not** specified delivery: call `lobe-user-interaction` → `askUserQuestion` **once** with options `聊天内预览（Artifact）` vs `钉盘链接（可预览可分享）`, then wait.',
      '- After choice: Artifact → complete `<lobeArtifact type="text/html">` (no file/dingpan); 钉盘 → `uploadHtmlToDingpan` + `preview_url` (UI also offers workspace preview — no extra lobeArtifact).',
      '- Skip the question when the user already asked for 钉盘/链接/分享 or 页面里看/Artifact/预览.',
      '- On DingTalk / other IM: default to 钉盘链接 (Artifact cannot render there).',
    ].join('\n');
  }

  // artifact
  return [
    '## HTML deliverable surface (agent preference — HARD)',
    'Mode: **聊天内预览（Artifact）** (`artifact`)',
    '- For HTML / interactive / visual reports: next assistant message must include a complete `<lobeArtifact type="text/html" ...>...</lobeArtifact>`.',
    '- Do **not** ask the user how to deliver.',
    '- Do **not** call `uploadHtmlToDingpan` unless the user explicitly asks for 钉盘 / 链接 / 分享.',
    '- No disk file / sandbox path solely to produce HTML for chat preview.',
    '- Exception: On DingTalk / other IM channels that cannot render Artifacts, use 钉盘链接 instead.',
  ].join('\n');
};

export const withHtmlDeliveryInstruction = (
  systemRole: string | undefined | null,
  mode?: string | null,
): string => {
  const block = buildHtmlDeliveryInstruction(mode);
  const base = systemRole?.trim() ?? '';
  return base ? `${base}\n\n${block}` : block;
};
