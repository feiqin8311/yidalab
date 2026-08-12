import { shapeToolResultForModel, unwrapMcpEnvelope } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { approxTokensFromText } from '@lobechat/types';
import type { OperationsToolApiRef } from '@lobechat/utils';
import debug from 'debug';

import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import type { MCPClientParams } from '@/libs/mcp';
import { mcpService } from '@/server/services/mcp';

import { rewriteToolApisToInstalled } from './resolveWorkspacePlugin';

const log = debug('lobe-server:ops-evidence');

const MAX_DOSSIER_TOKENS = 20_000;
const MAX_PER_TOOL_TOKENS = 3_000;
const MAX_STEPS = 8;

/**
 * Map ops form params onto a single MCP tool's expected argument bag.
 * Only known keys; no kitchen-sink extras that break strict schemas.
 */
export const buildArgsForTool = (
  apiName: string,
  params: Record<string, unknown>,
): Record<string, unknown> => {
  const dateRange = params.dateRange as { from?: string; to?: string } | undefined;
  const base: Record<string, unknown> = {};

  if (typeof params.asin === 'string' && params.asin) base.asin = params.asin;
  if (typeof params.marketplace === 'string' && params.marketplace) {
    base.marketplace = params.marketplace;
  }
  if (dateRange?.from) base.startDate = dateRange.from;
  if (dateRange?.to) base.endDate = dateRange.to;

  const name = apiName.toLowerCase();
  if (
    (name.includes('keyword') || name.includes('search')) &&
    Array.isArray(params.keywords) &&
    params.keywords.length
  ) {
    base.keywords = params.keywords;
  }
  if (name.includes('campaign') || name.includes('ad')) {
    if (typeof params.campaign === 'string' && params.campaign) base.campaign = params.campaign;
    if (typeof params.adGroup === 'string' && params.adGroup) base.adGroup = params.adGroup;
  }
  if (name.includes('competitor') && typeof params.competitorAsin === 'string') {
    base.competitorAsin = params.competitorAsin;
  }

  return base;
};

const toHttpClientParams = (
  identifier: string,
  connection: {
    auth?: { token?: string; type?: string };
    headers?: Record<string, string>;
    type?: string;
    url?: string;
  },
): MCPClientParams | null => {
  if (!connection?.url) return null;
  if (connection.type === 'stdio') return null;
  const params: MCPClientParams = {
    name: identifier,
    type: 'http',
    url: connection.url,
  };
  if (connection.headers) {
    (params as { headers?: Record<string, string> }).headers = connection.headers;
  }
  if (connection.auth?.type && connection.auth.type !== 'none') {
    (params as { auth?: { token?: string; type: string } }).auth = {
      token: connection.auth.token,
      type: connection.auth.type,
    };
  }
  return params;
};

export type EvidenceDossier = {
  text: string;
  toolCalls: number;
  tokens: number;
};

/**
 * Deterministic evidence prefetch for fixed ops modes.
 *
 * Security: ONLY workspace-scoped MCP rows (no findByIdentifierGlobal).
 * Optional plugins not installed in this workspace are skipped — never
 * borrow another workspace's connection/credentials.
 *
 * `pluginIds` is the capability-resolved install set for this run; DAG
 * identifiers are rewritten onto those aliases before lookup.
 */
export const buildEvidenceDossier = async (opts: {
  db: LobeChatDatabase;
  params: Record<string, unknown>;
  /** Capability-resolved plugin ids installed in this workspace for the run. */
  pluginIds: string[];
  /** Ordered API DAG from mode.toolApis. */
  toolApis: OperationsToolApiRef[];
  workspaceId: string;
}): Promise<EvidenceDossier | null> => {
  const { db, params, pluginIds, toolApis, workspaceId } = opts;

  const steps = rewriteToolApisToInstalled(toolApis, pluginIds)
    .filter((r) => r.identifier !== 'lobe-agent-documents' && r.apiName && r.apiName !== '*')
    .slice(0, MAX_STEPS);

  if (!steps.length) return null;

  const model = new CompanyMarketMcpModel(db, workspaceId);
  const clientById = new Map<string, MCPClientParams>();

  for (const step of steps) {
    if (clientById.has(step.identifier)) continue;
    try {
      // Workspace-scoped only — never global catalog with connection secrets.
      const row = await model.findByIdentifier(step.identifier);
      if (!row?.connection) {
        log('skip %s: not installed in workspace %s', step.identifier, workspaceId);
        continue;
      }
      const clientParams = toHttpClientParams(
        row.identifier || step.identifier,
        row.connection as any,
      );
      if (clientParams) clientById.set(step.identifier, clientParams);
    } catch (e) {
      log('manifest load failed for %s: %O', step.identifier, e);
    }
  }

  const sections: string[] = [];
  let ok = 0;

  for (const step of steps) {
    const clientParams = clientById.get(step.identifier);
    const header = `### ${step.identifier} / ${step.apiName}`;
    if (!clientParams) {
      sections.push(`${header}\n[skipped] not installed in this workspace`);
      continue;
    }

    try {
      const args = buildArgsForTool(step.apiName, params);
      const result = await mcpService.callTool({
        argsStr: JSON.stringify(args),
        clientParams,
        toolName: step.apiName,
      });

      const { content: unwrapped } = unwrapMcpEnvelope(result);
      const shaped = shapeToolResultForModel({
        maxTokens: MAX_PER_TOOL_TOKENS,
        raw: unwrapped,
        success: true,
      });
      sections.push(`${header}\n${shaped.content}`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sections.push(`${header}\n[error] ${msg.slice(0, 500)}`);
      log('tool %s:%s failed: %s', step.identifier, step.apiName, msg);
    }
  }

  if (!ok) return null;

  let text =
    `# Evidence Dossier (deterministic prefetch)\n` +
    `params=${JSON.stringify(params)}\n` +
    `tools_attempted=${steps.length} tools_ok=${ok}\n\n` +
    sections.join('\n\n');

  if (approxTokensFromText(text) > MAX_DOSSIER_TOKENS) {
    text = shapeToolResultForModel({ maxTokens: MAX_DOSSIER_TOKENS, raw: text }).content;
  }

  return {
    text,
    toolCalls: steps.length,
    tokens: approxTokensFromText(text),
  };
};
