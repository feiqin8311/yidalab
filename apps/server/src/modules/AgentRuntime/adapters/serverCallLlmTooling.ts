import { type AgentState, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';
import { DingpanDeliveryManifest, DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import {
  buildStepSkillDelta,
  buildStepToolDelta,
  type LobeToolManifest,
  type OperationToolSet,
  type ResolvedSkillSet,
  type ResolvedToolSet,
  SkillResolver,
  type ToolDiscoveryConfig,
  ToolResolver,
} from '@lobechat/context-engine';

import type { RuntimeExecutorContext } from '../context';
import { buildToolDiscoveryConfig, log } from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';

export interface ServerCallLlmTooling {
  resolved: ResolvedToolSet;
  resolvedSkills?: ResolvedSkillSet;
  toolDiscoveryConfig?: ToolDiscoveryConfig;
  tools?: ResolvedToolSet['tools'];
}

/** Bot / dingpan-mode runs keep uploadHtmlToDingpan under forceFinish. */
const shouldKeepDingpanOnForceFinish = (state: AgentState): boolean => {
  if (state.metadata?.botContext || state.metadata?.bot) return true;
  const mode =
    state.metadata?.htmlDeliveryMode ??
    state.metadata?.chatConfig?.htmlDeliveryMode ??
    state.metadata?.agentConfig?.chatConfig?.htmlDeliveryMode;
  return mode === 'dingpan';
};

/** Prefer this-operation uploads; never treat topic history as forceFinish done. */
const operationHasSuccessfulDingpanUpload = (state: AgentState, operationId?: string): boolean => {
  if (!operationId) return false;
  const outcomes = extractDingpanUploadOutcomes(
    (state.messages ?? [])
      .filter((message: any) => {
        const meta = message?.metadata as { operationId?: string } | undefined;
        // Require explicit operationId stamp — unstamped history must not count.
        return meta?.operationId === operationId;
      })
      .map((message: any) => ({
        content: message?.content,
        plugin: message?.plugin ?? {
          apiName: message?.apiName,
          identifier: message?.identifier,
        },
        role: message?.role,
      })),
  );
  return outcomes.some((o) => o.success && o.previewUrl);
};

export const resolveServerCallLlmTooling = (
  ctx: Pick<RuntimeExecutorContext, 'operationId' | 'stepIndex'>,
  state: AgentState,
  allowedToolNames?: string[],
): ServerCallLlmTooling => {
  // Resolve tools via ToolResolver (unified tool injection).
  //
  // Single-track device gate: `buildStepToolDelta` treats activeDeviceId as
  // an independent activation signal (it only dedupes against already-
  // enabled tools), so any id that reaches it WILL inject local-system.
  // `resolveRunActiveDeviceId` swallows the id whenever the plan/policy
  // forbids devices — the same filter the tool executors apply.
  const activeDeviceId = resolveRunActiveDeviceId(state.metadata);
  const operationToolSet: OperationToolSet = state.operationToolSet ?? {
    enabledToolIds: [],
    executorMap: state.toolExecutorMap ?? {},
    manifestMap: state.toolManifestMap ?? {},
    sourceMap: state.toolSourceMap ?? {},
    tools: state.tools ?? [],
  };

  const deliveryOnly =
    !!state.forceFinish &&
    shouldKeepDingpanOnForceFinish(state) &&
    !operationHasSuccessfulDingpanUpload(state, ctx.operationId);

  const stepDelta = buildStepToolDelta({
    activeDeviceId: deliveryOnly ? undefined : activeDeviceId,
    enabledToolIds: operationToolSet.enabledToolIds,
    forceFinish: state.forceFinish,
    forceFinishDeliveryManifests: deliveryOnly
      ? [DingpanDeliveryManifest as unknown as LobeToolManifest]
      : undefined,
    forceFinishDeliveryToolIds: deliveryOnly ? [DingpanIdentifier] : undefined,
    localSystemManifest: LocalSystemManifest as unknown as LobeToolManifest,
    operationManifestMap: operationToolSet.manifestMap,
  });

  const toolResolver = new ToolResolver();
  const resolved: ResolvedToolSet = toolResolver.resolve(
    operationToolSet,
    stepDelta,
    state.activatedStepTools ?? [],
    allowedToolNames,
  );

  const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
  const toolDiscoveryConfig = buildToolDiscoveryConfig(operationToolSet, resolved.enabledToolIds);

  if (stepDelta.activatedTools.length > 0) {
    log(
      `[${ctx.operationId}:${ctx.stepIndex}] ToolResolver injected %d step-level tools: %o`,
      stepDelta.activatedTools.length,
      stepDelta.activatedTools.map((tool) => tool.id),
    );
  }

  // Resolve skills via SkillResolver (unified skill injection).
  const skillResolver = new SkillResolver();
  const stepSkillDelta = buildStepSkillDelta();
  const resolvedSkills = state.metadata?.operationSkillSet
    ? skillResolver.resolve(
        state.metadata.operationSkillSet,
        stepSkillDelta,
        state.activatedStepSkills ?? [],
      )
    : undefined;

  return {
    resolved,
    resolvedSkills,
    toolDiscoveryConfig,
    tools,
  };
};
