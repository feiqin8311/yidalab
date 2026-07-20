import type { ResourceListScope } from '@lobechat/types';

import type { ResourceListVisibilityFilter } from './initialState';

/** Map UI mode toggle → API listScope. */
export const listVisibilityToListScope = (
  listVisibility: ResourceListVisibilityFilter,
): ResourceListScope => {
  switch (listVisibility) {
    case 'shared': {
      return 'shared_with_me';
    }
    case 'workspace': {
      return 'workspace';
    }
    case 'admin_all': {
      return 'admin_all';
    }
    default: {
      return 'mine';
    }
  }
};

/** Top-level upload visibility from the current list mode. */
export const listVisibilityToUploadVisibility = (
  listVisibility: ResourceListVisibilityFilter,
): 'private' | 'public' => {
  // Only the company tab publishes by default; all other modes land private.
  return listVisibility === 'workspace' ? 'public' : 'private';
};
