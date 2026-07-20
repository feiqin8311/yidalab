import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceListItem } from './hooks/useActiveWorkspace';
import { useWorkspaceState } from './workspaceState';

const workspace = (id: string): WorkspaceListItem => ({ id }) as WorkspaceListItem;

afterEach(() => {
  useWorkspaceState.setState({ activeWorkspaceId: null, workspaces: [] });
});

describe('workspaceState', () => {
  it('keeps activeWorkspaceId tied to the available company list', () => {
    useWorkspaceState.getState().setWorkspaces([workspace('ws-1'), workspace('ws-2')]);
    expect(useWorkspaceState.getState().activeWorkspaceId).toBe('ws-1');

    useWorkspaceState.getState().setActiveWorkspaceId('ws-2');
    useWorkspaceState.getState().setWorkspaces([workspace('ws-1'), workspace('ws-2')]);
    expect(useWorkspaceState.getState().activeWorkspaceId).toBe('ws-2');

    useWorkspaceState.getState().setWorkspaces([]);
    expect(useWorkspaceState.getState().activeWorkspaceId).toBeNull();
  });
});
