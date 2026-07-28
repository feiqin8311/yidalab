/**
 * MCP availability claim guard.
 *
 * Models sometimes activate an MCP, never call it, then invent
 * "密钥过期 / unavailable". Authority is tool traffic, not assistant prose:
 * activated + 0 API calls ⇒ may only say "未调用", never credential failure.
 */

export const ACTIVATOR_TOOL_IDENTIFIER = 'lobe-activator';

/** Known MCP display aliases (identifier → labels used in prose / HTML). */
export const MCP_DISPLAY_ALIASES: Record<string, string[]> = {
  'company.mcp.lingxing-mcp': ['领星', 'lingxing-mcp', 'lingxing', 'Lingxing'],
  'company.mcp.sellersprite-mcp': ['卖家精灵', 'sellersprite-mcp', 'sellersprite', 'SellerSprite'],
  'company.mcp.sif-mcp': ['SIF', 'sif-mcp', 'sif', 'Sorftime'],
};

export type McpClaimGuardMessage = {
  children?: Array<{ tools?: Array<Record<string, unknown>> }>;
  compressedMessages?: McpClaimGuardMessage[];
  content?: unknown;
  plugin?: { apiName?: string; identifier?: string } | null;
  pluginState?: unknown;
  role?: string;
};

export type ActivatedMcpTool = {
  /** Primary human label for rewrites */
  display: string;
  identifier: string;
  /** All labels used to detect claims in prose/HTML */
  labels: string[];
  name: string;
};

type ToolInvocation = {
  apiName?: string;
  identifier?: string;
  state?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const collectToolInvocations = (msg: McpClaimGuardMessage): ToolInvocation[] => {
  if (msg.role === 'tool') {
    return [
      {
        apiName: msg.plugin?.apiName,
        identifier: msg.plugin?.identifier,
        state: msg.pluginState,
      },
    ];
  }

  const invocations: ToolInvocation[] = [];

  if (Array.isArray(msg.children)) {
    for (const child of msg.children) {
      if (!Array.isArray(child?.tools)) continue;
      for (const tool of child.tools) {
        const result = asRecord(tool.result);
        invocations.push({
          apiName: typeof tool.apiName === 'string' ? tool.apiName : undefined,
          identifier: typeof tool.identifier === 'string' ? tool.identifier : undefined,
          state: result?.state,
        });
      }
    }
  }

  if (Array.isArray(msg.compressedMessages)) {
    for (const compressed of msg.compressedMessages) {
      invocations.push(...collectToolInvocations(compressed));
    }
  }

  return invocations;
};

const isMcpIdentifier = (identifier: string): boolean =>
  identifier.startsWith('company.mcp.') || /(?:^|[./-])mcp(?:$|[./-])/i.test(identifier);

const labelsForMcp = (identifier: string, name: string): string[] => {
  const known = MCP_DISPLAY_ALIASES[identifier] ?? [];
  const base = name?.trim() || identifier;
  const short = base.replace(/-mcp$/i, '');
  const uniq = new Set<string>(
    [...known, base, short, identifier].map((s) => s.trim()).filter(Boolean),
  );
  // Prefer longer labels first so "sellersprite-mcp" matches before "sif" substrings etc.
  return [...uniq].sort((a, b) => b.length - a.length);
};

const primaryDisplay = (identifier: string, name: string): string => {
  const known = MCP_DISPLAY_ALIASES[identifier];
  if (known?.[0]) return known[0];
  const base = name?.trim() || identifier;
  return base.replace(/-mcp$/i, '') || identifier;
};

/**
 * Collect MCP tools successfully activated via lobe-activator.activateTools.
 */
export const extractActivatedMcps = (messages: McpClaimGuardMessage[]): ActivatedMcpTool[] => {
  const byId = new Map<string, ActivatedMcpTool>();

  for (const msg of messages) {
    for (const invocation of collectToolInvocations(msg)) {
      if (invocation.identifier !== ACTIVATOR_TOOL_IDENTIFIER) continue;
      if (invocation.apiName !== 'activateTools') continue;

      const state = asRecord(invocation.state);
      const activated = state?.activatedTools;
      if (!Array.isArray(activated)) continue;

      for (const item of activated) {
        const row = asRecord(item);
        if (!row) continue;
        const identifier = typeof row.identifier === 'string' ? row.identifier : '';
        if (!identifier || !isMcpIdentifier(identifier)) continue;
        const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : identifier;
        byId.set(identifier, {
          display: primaryDisplay(identifier, name),
          identifier,
          labels: labelsForMcp(identifier, name),
          name,
        });
      }
    }
  }

  return [...byId.values()];
};

/**
 * Count non-activator API calls per tool identifier (MCP business tools).
 */
export const countToolApiCallsByIdentifier = (
  messages: McpClaimGuardMessage[],
): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const msg of messages) {
    for (const invocation of collectToolInvocations(msg)) {
      const id = invocation.identifier;
      if (!id || id === ACTIVATOR_TOOL_IDENTIFIER) continue;
      if (invocation.apiName === 'activateTools' || invocation.apiName === 'activateSkill') {
        continue;
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return counts;
};

export const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrite false "MCP unavailable / key expired" claims for tools that were
 * activated but never invoked. No-op when nothing matches.
 */
export const applyMcpAvailabilityClaimGuard = (
  content: string,
  messages: McpClaimGuardMessage[],
): string => {
  if (typeof content !== 'string' || !content) return content;

  const activated = extractActivatedMcps(messages);
  if (activated.length === 0) return content;

  const callCounts = countToolApiCallsByIdentifier(messages);
  const zeroCall = activated.filter((mcp) => (callCounts.get(mcp.identifier) ?? 0) === 0);
  if (zeroCall.length === 0) return content;

  let next = content;

  for (const mcp of zeroCall) {
    const honest = `已激活但未调用「${mcp.display}」，相关数据缺失（非密钥校验失败）`;

    for (const label of mcp.labels) {
      const L = escapeRegExp(label);
      const patterns: RegExp[] = [
        // 卖家精灵：密钥过期，不可用 / 卖家精灵密钥已过期，无法使用
        new RegExp(
          `${L}\\s*[:：]?\\s*密钥\\s*已?\\s*过期(?:[，,、]?\\s*(?:不可用|无法使用|无法连接))?`,
          'gi',
        ),
        // 卖家精灵密钥失效 / key expired
        new RegExp(
          `${L}\\s*[:：]?\\s*(?:的)?(?:API\\s*)?(?:密钥|key)\\s*(?:已)?(?:过期|失效)`,
          'gi',
        ),
        new RegExp(
          `${L}\\s*[:：]?\\s*(?:API\\s*)?(?:key|credential)s?\\s*(?:is\\s*|are\\s*)?(?:expired|invalid|unavailable)`,
          'gi',
        ),
        // 卖家精灵不可用 / unavailable（仅当与「密钥/连接/权限」同句时）
        new RegExp(
          `${L}\\s*[:：]?\\s*(?:因[^。\\n]{0,12})?(?:密钥|连接|权限|凭证)[^。\\n]{0,16}(?:不可用|无法使用|失败)`,
          'gi',
        ),
        new RegExp(`${L}\\s+(?:is\\s+)?(?:unavailable|not\\s+available|expired)\\b`, 'gi'),
      ];

      for (const re of patterns) {
        next = next.replace(re, honest);
      }
    }
  }

  return next;
};
