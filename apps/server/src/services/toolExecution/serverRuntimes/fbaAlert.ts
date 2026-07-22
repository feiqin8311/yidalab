import { FbaAlertApiName, FbaAlertIdentifier } from '@lobechat/builtin-tool-fba-alert';
import type { BuiltinServerRuntimeOutput, ChatTopicBotContext } from '@lobechat/types';

import { runPersonalFbaAlert } from '@/server/services/fbaAlert';

import type { ToolExecutionContext } from '../types';
import type { ServerRuntimeRegistration } from './types';

const SCOPES = new Set([
  'all',
  'us',
  'ca',
  'jp',
  'eu',
  'ezarc',
  'yplus',
  'ezarc-test',
  'yplus-test',
]);

const MODES = new Set(['self', 'dry_run', 'upload_only'] as const);

const fail = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

/**
 * Server runtime: model only passes scope/mode; identity is injected here.
 */
export const fbaAlertRuntime: ServerRuntimeRegistration = {
  factory: (context: ToolExecutionContext) => ({
    [FbaAlertApiName.runFbaAlert]: async (args: {
      mode?: string;
      scope?: string;
    }): Promise<BuiltinServerRuntimeOutput> => {
      const scope = (args?.scope ?? '').trim().toLowerCase();
      if (!SCOPES.has(scope)) {
        return fail(
          `Invalid scope "${args?.scope ?? ''}". Use one of: ${[...SCOPES].join(', ')}`,
          'INVALID_SCOPE',
        );
      }

      const modeRaw = (args?.mode ?? 'self').trim().toLowerCase();
      if (!MODES.has(modeRaw as 'self')) {
        return fail(
          `Invalid mode "${args?.mode}". Use self | dry_run | upload_only`,
          'INVALID_MODE',
        );
      }
      const mode = modeRaw as 'self' | 'dry_run' | 'upload_only';

      if (!context.serverDB || !context.userId) {
        return fail('Missing serverDB/userId in tool context', 'NO_CONTEXT');
      }
      if (!context.agentId) {
        return fail(
          'Missing agentId in tool context (needed for channel Owner fallback)',
          'NO_AGENT',
        );
      }

      try {
        const { identitySource, job } = await runPersonalFbaAlert({
          agentId: context.agentId,
          botContext: context.botContext as ChatTopicBotContext | null | undefined,
          mode,
          scope,
          serverDB: context.serverDB,
          userId: context.userId,
          wait: true,
          workspaceId: context.workspaceId,
        });

        if (job.status === 'failed') {
          return fail(
            `FBA alert job failed: ${job.error ?? 'unknown error'} (job_id=${job.job_id}, identity=${identitySource})`,
            'JOB_FAILED',
          );
        }

        const summary = {
          alert_count: job.result?.alert_count,
          fetched_count: job.result?.fetched_count,
          identity_source: identitySource,
          job_id: job.job_id,
          mode,
          report_path: job.result?.report_path,
          scope,
          sid_distribution: job.result?.sid_distribution,
          status: job.status,
        };

        return {
          content: JSON.stringify(summary, null, 2),
          state: summary,
          success: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(message, 'FBA_ALERT_ERROR');
      }
    },
  }),
  identifier: FbaAlertIdentifier,
};
