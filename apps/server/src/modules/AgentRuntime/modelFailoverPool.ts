import type { WorkingModel } from '@lobechat/types';

interface AvailableChatModel {
  abilities?: { functionCall?: boolean };
  id: string;
  providerId: string;
  type: string;
}

interface BuildModelFailoverPoolInput {
  enabledModels: AvailableChatModel[];
  enabledProviderIds: string[];
  isAllowed?: (candidate: WorkingModel) => boolean;
  primary: WorkingModel;
  requiresFunctionCall: boolean;
}

const candidateKey = ({ model, provider }: WorkingModel) => `${provider}\0${model}`;

/**
 * Builds a provider-diverse fallback pool from the same enabled chat models
 * exposed by the conversation model picker. A sibling model from the current
 * provider comes first for model-specific failures, followed by one model per
 * other provider before the remaining models are interleaved.
 */
export const buildModelFailoverPool = ({
  enabledModels,
  enabledProviderIds,
  isAllowed = () => true,
  primary,
  requiresFunctionCall,
}: BuildModelFailoverPoolInput): WorkingModel[] => {
  const primaryKey = candidateKey(primary);
  const providerQueues = enabledProviderIds.map((provider) => ({
    models: enabledModels
      .filter(
        (model) =>
          model.providerId === provider &&
          model.type === 'chat' &&
          (!requiresFunctionCall || model.abilities?.functionCall !== false),
      )
      .map((model) => ({ model: model.id, provider }))
      .filter((candidate) => candidateKey(candidate) !== primaryKey)
      .filter(isAllowed),
    provider,
  }));
  const currentProviderQueue = providerQueues.find(({ provider }) => provider === primary.provider);
  const otherProviderQueues = providerQueues.filter(
    ({ provider }) => provider !== primary.provider,
  );
  const result: WorkingModel[] = [];
  const seen = new Set<string>();
  const append = (candidate: WorkingModel | undefined) => {
    if (!candidate) return;
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(candidate);
  };

  append(currentProviderQueue?.models.shift());
  for (const queue of otherProviderQueues) append(queue.models.shift());

  const remainingQueues = [currentProviderQueue, ...otherProviderQueues].filter(
    (queue): queue is NonNullable<typeof queue> => Boolean(queue),
  );
  while (remainingQueues.some((queue) => queue.models.length > 0)) {
    for (const queue of remainingQueues) append(queue.models.shift());
  }

  return result;
};
