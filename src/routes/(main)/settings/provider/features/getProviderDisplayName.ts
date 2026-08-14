import type { AiProviderListItem } from '@/types/aiProvider';

export const getProviderDisplayName = ({ id, name }: Pick<AiProviderListItem, 'id' | 'name'>) =>
  name?.trim() || id;
