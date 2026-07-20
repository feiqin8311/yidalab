import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { ActivatedToolInfo, ActivateSkillParams, ActivateToolsParams } from '../types';

/** Same separator as ToolNameResolver / PLUGIN_SCHEMA_SEPARATOR (`identifier____apiName`). */
const TOOL_NAME_SEPARATOR = '____';

/**
 * Models sometimes pass function-call form `tool____api` (or `tool____api____type`)
 * into activateTools. Activation only knows tool identifiers — strip the rest.
 */
export function normalizeActivationIdentifier(id: string): string {
  if (!id) return id;
  const sep = id.indexOf(TOOL_NAME_SEPARATOR);
  return sep === -1 ? id : id.slice(0, sep);
}

/** Normalize, drop empties, preserve order, dedupe. */
export function normalizeActivationIdentifiers(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = normalizeActivationIdentifier(raw.trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** One-line short desc for activation summaries (keeps token cost down). */
export function summarizeApiDescription(description: string | undefined, maxLen = 80): string {
  if (!description) return '';
  const firstLine = description.split(/\r?\n/)[0].replaceAll(/\s+/g, ' ').trim();
  if (!firstLine) return '';
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, Math.max(0, maxLen - 1))}…`;
}

function isCompanyMcpIdentifier(identifier: string): boolean {
  return identifier.startsWith('company.mcp.');
}

function formatActivatedToolContent(manifest: ToolManifestInfo): string {
  const header = `\n## ${manifest.name} (${manifest.identifier})`;

  // Company MCP manifests ship very long API docs / systemRole; activation only
  // needs names + a short hint. Full request schemas are injected as native tools next turn.
  if (isCompanyMcpIdentifier(manifest.identifier)) {
    const lines = [
      header,
      'Tool activated. Full request schemas are available as native function calls — use APIs by name:',
    ];
    for (const api of manifest.apiDescriptions) {
      const short = summarizeApiDescription(api.description);
      lines.push(short ? `- **${api.name}**: ${short}` : `- **${api.name}**`);
    }
    return lines.join('\n');
  }

  const parts = [header];
  if (manifest.systemRole) {
    parts.push(manifest.systemRole);
  }
  if (manifest.apiDescriptions.length > 0) {
    parts.push('\nAvailable APIs:');
    for (const api of manifest.apiDescriptions) {
      parts.push(`- **${api.name}**: ${api.description}`);
    }
  }
  return parts.join('\n');
}

export interface ToolManifestInfo {
  apiDescriptions: Array<{ description: string; name: string }>;
  avatar?: string;
  identifier: string;
  name: string;
  systemRole?: string;
}

export interface ActivatorRuntimeService {
  activateSkill?: (args: ActivateSkillParams) => Promise<BuiltinServerRuntimeOutput>;
  getActivatedToolIds: () => string[];
  getToolManifests: (identifiers: string[]) => Promise<ToolManifestInfo[]>;
  markActivated: (identifiers: string[]) => void;
}

export interface ActivatorExecutionRuntimeOptions {
  service: ActivatorRuntimeService;
}

export class ActivatorExecutionRuntime {
  private service: ActivatorRuntimeService;

  constructor(options: ActivatorExecutionRuntimeOptions) {
    this.service = options.service;
  }

  async activateSkill(args: ActivateSkillParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.activateSkill) {
      return {
        content: 'Skill activation is not available.',
        success: false,
      };
    }

    return this.service.activateSkill(args);
  }

  async activateTools(args: ActivateToolsParams): Promise<BuiltinServerRuntimeOutput> {
    const { identifiers } = args;

    if (!identifiers || identifiers.length === 0) {
      return {
        content: 'No tool identifiers provided. Please specify which tools to activate.',
        success: false,
      };
    }

    try {
      // Accept `tool____api` typos from the model as tool-level identifiers.
      const normalizedIds = normalizeActivationIdentifiers(identifiers);
      const alreadyActive = this.service.getActivatedToolIds();
      const toActivate: string[] = [];
      const alreadyActiveList: string[] = [];

      for (const id of normalizedIds) {
        if (alreadyActive.includes(id)) {
          alreadyActiveList.push(id);
        } else {
          toActivate.push(id);
        }
      }

      // Fetch manifests for tools to activate
      const manifests = await this.service.getToolManifests(toActivate);

      const foundIdentifiers = new Set(manifests.map((m) => m.identifier));
      const notFoundAsTools = toActivate.filter((id) => !foundIdentifiers.has(id));

      // Fallback: try activating not-found identifiers as skills
      const activatedSkillResults: BuiltinServerRuntimeOutput[] = [];
      const notFound: string[] = [];

      if (notFoundAsTools.length > 0 && this.service.activateSkill) {
        for (const id of notFoundAsTools) {
          try {
            const skillResult = await this.service.activateSkill({ name: id });
            if (skillResult.success) {
              activatedSkillResults.push(skillResult);
            } else {
              notFound.push(id);
            }
          } catch {
            notFound.push(id);
          }
        }
      } else {
        notFound.push(...notFoundAsTools);
      }

      const activatedTools: ActivatedToolInfo[] = manifests.map((m) => ({
        apiCount: m.apiDescriptions.length,
        avatar: m.avatar,
        identifier: m.identifier,
        name: m.name,
      }));

      // Mark newly activated tools
      if (manifests.length > 0) {
        this.service.markActivated(manifests.map((m) => m.identifier));
      }

      // Build response content
      const parts: string[] = [];

      if (activatedTools.length > 0) {
        parts.push('Successfully activated tools:');
        for (const manifest of manifests) {
          parts.push(formatActivatedToolContent(manifest));
        }
      }

      if (activatedSkillResults.length > 0) {
        for (const skillResult of activatedSkillResults) {
          parts.push(skillResult.content);
        }
      }

      if (alreadyActiveList.length > 0) {
        parts.push(`\nAlready active: ${alreadyActiveList.join(', ')}`);
      }

      if (notFound.length > 0) {
        parts.push(`\nNot found: ${notFound.join(', ')}`);
      }

      return {
        content: parts.join('\n'),
        state: {
          activatedSkills: activatedSkillResults.map((r) => r.state),
          activatedTools,
          alreadyActive: alreadyActiveList,
          notFound,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to activate tools: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
