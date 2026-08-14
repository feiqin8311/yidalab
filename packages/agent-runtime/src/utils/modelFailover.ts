import type { WorkingModel } from '@lobechat/types';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';

import type { ClassifiedLLMError } from './llmErrorClassifier';

export const MAX_MODEL_FAILOVER_CANDIDATES = 5;
export const ACTIVE_MODEL_CANDIDATE_METADATA_KEY = 'activeModelCandidate';

const FAILOVER_ELIGIBLE_STOP_CODES = new Set<string>([
  AgentRuntimeErrorType.AccountDeactivated,
  AgentRuntimeErrorType.CapabilityNotSupported,
  AgentRuntimeErrorType.ExceededContextWindow,
  AgentRuntimeErrorType.ExceededToolLimit,
  AgentRuntimeErrorType.InsufficientQuota,
  AgentRuntimeErrorType.InvalidBedrockCredentials,
  AgentRuntimeErrorType.InvalidGithubCopilotToken,
  AgentRuntimeErrorType.InvalidGithubToken,
  AgentRuntimeErrorType.InvalidProviderAPIKey,
  AgentRuntimeErrorType.InvalidVertexCredentials,
  AgentRuntimeErrorType.LocationNotSupportError,
  AgentRuntimeErrorType.ModelNotFound,
  AgentRuntimeErrorType.NoAvailableChannel,
  AgentRuntimeErrorType.NoAvailableProvider,
  AgentRuntimeErrorType.NoOpenAIAPIKey,
  AgentRuntimeErrorType.PermissionDenied,
  AgentRuntimeErrorType.UpstreamMalformedResponse,
  AgentRuntimeErrorType.UserConfigError,
  ChatErrorType.FreePlanLimit,
  ChatErrorType.InsufficientBudgetForModel,
  ChatErrorType.LobeHubModelDeprecated,
]);

const candidateKey = ({ model, provider }: WorkingModel) => `${provider}\0${model}`;

const isValidCandidate = (candidate: WorkingModel | undefined): candidate is WorkingModel =>
  Boolean(candidate?.model.trim() && candidate.provider.trim());

/**
 * Builds a bounded, de-duplicated candidate chain. When a previous step already
 * failed over, rotate that healthy candidate to the front for the rest of the
 * operation so every tool round does not re-pay the known-bad primary timeout.
 */
export const resolveModelFailoverCandidates = (
  primary: WorkingModel,
  fallbacks: WorkingModel[] | undefined,
  activeCandidate?: WorkingModel,
) => {
  const candidates = [primary, ...(fallbacks ?? [])]
    .map((candidate) => ({ model: candidate.model.trim(), provider: candidate.provider.trim() }))
    .filter(isValidCandidate)
    .filter((candidate, index, items) => {
      const key = candidateKey(candidate);
      return items.findIndex((item) => candidateKey(item) === key) === index;
    })
    .slice(0, MAX_MODEL_FAILOVER_CANDIDATES + 1);

  if (!activeCandidate) return candidates;

  const activeIndex = candidates.findIndex(
    (candidate) => candidateKey(candidate) === candidateKey(activeCandidate),
  );
  if (activeIndex <= 0) return candidates;

  return [...candidates.slice(activeIndex), ...candidates.slice(0, activeIndex)];
};

/**
 * Retryable provider failures are always eligible. A small allowlist of
 * terminal errors is also eligible when changing provider/model can actually
 * repair the call (credentials, quota, model availability, or capability).
 * Prompt/policy and runtime persistence failures intentionally stay terminal.
 */
export const shouldFailoverModel = ({ code, kind }: ClassifiedLLMError) =>
  kind === 'retry' || (code ? FAILOVER_ELIGIBLE_STOP_CODES.has(code) : false);
