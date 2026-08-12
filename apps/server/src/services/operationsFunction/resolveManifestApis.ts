import type { LobeChatDatabase } from '@lobechat/database';

import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';

/**
 * Resolve identifier → API name list for ops context policy expansion.
 * Workspace-scoped only — never reads another workspace's MCP row
 * (which may carry connection secrets).
 */
export const resolveManifestApisForPlugins = async (
  db: LobeChatDatabase,
  workspaceId: string,
  pluginIds: string[],
): Promise<Record<string, Array<{ name: string; type?: string }>>> => {
  const model = new CompanyMarketMcpModel(db, workspaceId);
  const out: Record<string, Array<{ name: string; type?: string }>> = {};

  await Promise.all(
    pluginIds.map(async (pluginId) => {
      try {
        const row = await model.findByIdentifier(pluginId);
        if (!row?.tools || !Array.isArray(row.tools)) return;
        const apis = row.tools
          .map((t) => {
            const name =
              typeof t?.name === 'string'
                ? t.name
                : typeof (t as { toolName?: string })?.toolName === 'string'
                  ? (t as { toolName: string }).toolName
                  : null;
            return name ? { name, type: 'mcp' as const } : null;
          })
          .filter(Boolean) as Array<{ name: string; type?: string }>;
        if (apis.length) out[pluginId] = apis;
        if (row.identifier && row.identifier !== pluginId && apis.length) {
          out[row.identifier] = apis;
        }
      } catch {
        // best-effort
      }
    }),
  );

  return out;
};
