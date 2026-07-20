import type { SWRResponse } from 'swr';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { knowledgeBaseKeys } from '@/libs/swr/keys';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import type { KnowledgeBaseStore } from '@/store/library/store';
import type { StoreSetter } from '@/store/types';
import type { CreateKnowledgeBaseParams, KnowledgeBaseItem } from '@/types/knowledgeBase';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createCrudSlice = (set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) =>
  new KnowledgeBaseCrudActionImpl(set, get, _api);

export class KnowledgeBaseCrudActionImpl {
  readonly #get: () => KnowledgeBaseStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createNewKnowledgeBase = async (params: CreateKnowledgeBaseParams): Promise<string> => {
    const id = await knowledgeBaseService.createKnowledgeBase(params);

    await this.#get().refreshKnowledgeBaseList();

    return id;
  };

  internal_toggleKnowledgeBaseLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { knowledgeBaseLoadingIds: [...state.knowledgeBaseLoadingIds, id] };

        return { knowledgeBaseLoadingIds: state.knowledgeBaseLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleKnowledgeBaseLoading',
    );
  };

  refreshKnowledgeBaseList = async (): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();
    // Invalidate every list surface that can be rendered (legacy visibility + listScope).
    await Promise.all([
      mutate(knowledgeBaseKeys.list(workspaceId)),
      mutate(knowledgeBaseKeys.list(workspaceId, 'private')),
      mutate(knowledgeBaseKeys.list(workspaceId, 'public')),
      mutate(knowledgeBaseKeys.list(workspaceId, 'mine')),
      mutate(knowledgeBaseKeys.list(workspaceId, 'shared_with_me')),
      mutate(knowledgeBaseKeys.list(workspaceId, 'workspace')),
      mutate(knowledgeBaseKeys.list(workspaceId, 'admin_all')),
    ]);
  };

  removeKnowledgeBase = async (id: string): Promise<void> => {
    await knowledgeBaseService.deleteKnowledgeBase(id);
    await this.#get().refreshKnowledgeBaseList();
  };

  publishKnowledgeBaseToWorkspace = async (id: string): Promise<void> => {
    await knowledgeBaseService.publishKnowledgeBaseToWorkspace(id);
    await this.#get().refreshKnowledgeBaseList();
  };

  setKnowledgeBaseVisibility = async (
    id: string,
    visibility: 'private' | 'public',
  ): Promise<void> => {
    await knowledgeBaseService.setKnowledgeBaseVisibility(id, visibility);
    await this.#get().refreshKnowledgeBaseList();
  };

  updateKnowledgeBase = async (id: string, value: CreateKnowledgeBaseParams): Promise<void> => {
    this.#get().internal_toggleKnowledgeBaseLoading(id, true);
    await knowledgeBaseService.updateKnowledgeBaseList(id, value);
    await this.#get().refreshKnowledgeBaseList();

    this.#get().internal_toggleKnowledgeBaseLoading(id, false);
  };

  useFetchKnowledgeBaseItem = (id: string): SWRResponse<KnowledgeBaseItem | undefined> => {
    return useClientDataSWR<KnowledgeBaseItem | undefined>(
      knowledgeBaseKeys.item(id),
      () => knowledgeBaseService.getKnowledgeBaseById(id),
      {
        onSuccess: (item) => {
          if (!item) return;

          this.#set({
            activeKnowledgeBaseId: id,
            activeKnowledgeBaseItems: {
              ...this.#get().activeKnowledgeBaseItems,
              [id]: item,
            },
          });
        },
      },
    );
  };

  useFetchKnowledgeBaseList = (
    filter?: 'private' | 'public' | 'mine' | 'shared_with_me' | 'workspace' | 'admin_all',
  ): SWRResponse<KnowledgeBaseItem[]> => {
    const workspaceId = getActiveWorkspaceId();
    const isListScope =
      filter === 'mine' ||
      filter === 'shared_with_me' ||
      filter === 'workspace' ||
      filter === 'admin_all';
    return useClientDataSWR<KnowledgeBaseItem[]>(
      knowledgeBaseKeys.list(workspaceId, filter),
      () =>
        knowledgeBaseService.getKnowledgeBaseList(
          filter
            ? isListScope
              ? { listScope: filter }
              : { visibility: filter as 'private' | 'public' }
            : undefined,
        ),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!this.#get().initKnowledgeBaseList)
            this.#set({ initKnowledgeBaseList: true }, false, 'useFetchKnowledgeBaseList/init');
        },
      },
    );
  };
}

export type KnowledgeBaseCrudAction = Pick<
  KnowledgeBaseCrudActionImpl,
  keyof KnowledgeBaseCrudActionImpl
>;
