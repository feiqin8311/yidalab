import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { createSystemRole } from './systemRole';

/** Builtin skill: HTML/SVG/React deliverables via `<lobeArtifact>` (packages/builtin-skills). */
const ARTIFACTS_SKILL_ID = 'lobe-artifacts';

/**
 * Company / market skill identifiers are namespaced `company.*`. Pinning dozens
 * of them on the default Inbox injects full skill bodies every turn and
 * multiplies token cost. They stay installable and activatable on demand —
 * just not always-on for the personal default agent.
 */
const isCompanyMarketPluginId = (id: string) => id.startsWith('company.');

/**
 * Inbox Agent - the default assistant agent for general conversations
 *
 * Note: model and provider are intentionally undefined to use user's default settings
 *
 * Artifacts is always pinned so HTML/SVG/React deliverables use <lobeArtifact>
 * without requiring activateSkill first (everyone's default assistant).
 *
 * User plugins are merged after builtins, but company market skills are stripped
 * so a bulk-pin does not bloat every chat. Users can still activateSkill them.
 */
const INBOX_CORE_PLUGINS = [
  AgentDocumentsIdentifier,
  UserInteractionIdentifier,
  ARTIFACTS_SKILL_ID,
] as const;

export const INBOX: BuiltinAgentDefinition = {
  avatar: '/avatars/yida-ai.png',
  runtime: (ctx) => {
    const core = new Set<string>(INBOX_CORE_PLUGINS);
    const extras = (ctx.plugins || []).filter(
      (id) => !isCompanyMarketPluginId(id) && !core.has(id),
    );
    return {
      plugins: [...INBOX_CORE_PLUGINS, ...extras],
      systemRole: createSystemRole(ctx.userLocale, ctx.agentDisplayName),
    };
  },

  slug: BUILTIN_AGENT_SLUGS.inbox,
};
