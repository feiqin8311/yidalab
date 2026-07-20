import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as useActiveWorkspaceIdModule from '@/business/client/hooks/useActiveWorkspaceId';
import * as useIsWorkspaceLoadingModule from '@/business/client/hooks/useIsWorkspaceLoading';
import * as useSwitchWorkspaceModule from '@/business/client/hooks/useSwitchWorkspace';
import * as useWorkspacesModule from '@/business/client/hooks/useWorkspaces';

import { useWorkspaceFromSlug } from '../useWorkspaceFromSlug';
import { useWorkspaceUrlSync } from '../useWorkspaceUrlSync';

vi.mock('react-router', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useNavigate: vi.fn(actual.useNavigate),
  };
});

interface WorkspaceStateMock {
  activeWorkspaceId: null | string;
  isWorkspaceLoading: boolean;
  navigate: ReturnType<typeof vi.fn>;
  switchWorkspace: (id: string) => void;
  workspaces: { id: string; lockedOut?: boolean; slug: string }[];
}

const createState = (overrides: Partial<WorkspaceStateMock> = {}): WorkspaceStateMock => ({
  activeWorkspaceId: null,
  isWorkspaceLoading: false,
  navigate: vi.fn(),
  switchWorkspace: vi.fn(),
  workspaces: [{ id: 'ws-1', slug: 'acme' }],
  ...overrides,
});

const mockWorkspaceStore = (state: WorkspaceStateMock) => {
  vi.spyOn(useWorkspacesModule, 'useWorkspaces').mockReturnValue(state.workspaces as any);
  vi.spyOn(useIsWorkspaceLoadingModule, 'useIsWorkspaceLoading').mockReturnValue(
    state.isWorkspaceLoading,
  );
  vi.spyOn(useActiveWorkspaceIdModule, 'useActiveWorkspaceId').mockReturnValue(
    state.activeWorkspaceId,
  );
  vi.spyOn(useSwitchWorkspaceModule, 'useSilentSwitchWorkspace').mockReturnValue({
    switchWorkspace: state.switchWorkspace as any,
  });
  vi.mocked(useNavigate).mockReturnValue(state.navigate as any);
};

const createRouteWrapper =
  (initialEntry: string, path = '/:workspaceSlug/*') =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={children} path={path} />
      </Routes>
    </MemoryRouter>
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWorkspaceFromSlug', () => {
  it('returns ok when the URL slug matches a workspace', () => {
    mockWorkspaceStore(createState());

    const { result } = renderHook(() => useWorkspaceFromSlug(), {
      wrapper: createRouteWrapper('/acme/settings'),
    });

    expect(result.current).toEqual({ slug: 'acme', status: 'ok', workspaceId: 'ws-1' });
  });

  it('returns loading for an unknown slug while workspaces are loading', () => {
    mockWorkspaceStore(createState({ isWorkspaceLoading: true, workspaces: [] }));

    const { result } = renderHook(() => useWorkspaceFromSlug(), {
      wrapper: createRouteWrapper('/acme/settings'),
    });

    expect(result.current).toEqual({ slug: 'acme', status: 'loading' });
  });

  it('returns not-found for an unknown slug after loading completes', () => {
    mockWorkspaceStore(createState({ workspaces: [] }));

    const { result } = renderHook(() => useWorkspaceFromSlug(), {
      wrapper: createRouteWrapper('/missing/settings'),
    });

    expect(result.current).toEqual({ slug: 'missing', status: 'not-found' });
  });

  it('returns no-slug outside the workspace route tree', () => {
    mockWorkspaceStore(createState());

    const { result } = renderHook(() => useWorkspaceFromSlug(), {
      wrapper: createRouteWrapper('/settings/profile', '/settings/*'),
    });

    expect(result.current).toEqual({ status: 'no-slug' });
  });
});

describe('useWorkspaceUrlSync', () => {
  it('switches to the workspace when the first segment is a known slug', () => {
    const state = createState();
    mockWorkspaceStore(state);

    renderHook(() => useWorkspaceUrlSync(), {
      wrapper: createRouteWrapper('/acme/agent/inbox', '*'),
    });

    expect(state.switchWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('does not switch while the workspace list is loading', () => {
    const state = createState({ isWorkspaceLoading: true });
    mockWorkspaceStore(state);

    renderHook(() => useWorkspaceUrlSync(), {
      wrapper: createRouteWrapper('/acme/agent/inbox', '*'),
    });

    expect(state.switchWorkspace).not.toHaveBeenCalled();
  });

  it('leaves the current workspace untouched for an unknown slug', () => {
    const state = createState({ activeWorkspaceId: 'ws-1' });
    mockWorkspaceStore(state);

    renderHook(() => useWorkspaceUrlSync(), {
      wrapper: createRouteWrapper('/unknown/agent/inbox', '*'),
    });

    expect(state.switchWorkspace).not.toHaveBeenCalled();
  });

  it('keeps the current company on reserved routes', () => {
    const state = createState({ activeWorkspaceId: null });
    mockWorkspaceStore(state);

    renderHook(() => useWorkspaceUrlSync(), {
      wrapper: createRouteWrapper('/settings/profile', '*'),
    });

    expect(state.switchWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('prefixes company-scoped main surfaces with the company slug', () => {
    const state = createState({ activeWorkspaceId: 'ws-1' });
    mockWorkspaceStore(state);

    renderHook(() => useWorkspaceUrlSync(), {
      wrapper: createRouteWrapper('/agent/inbox', '*'),
    });

    expect(state.navigate).toHaveBeenCalledWith('/acme/agent/inbox', { replace: true });
  });

  it('does not rewrite personal-only settings under the company slug', () => {
    const state = createState({ activeWorkspaceId: 'ws-1' });
    mockWorkspaceStore(state);

    renderHook(() => useWorkspaceUrlSync(), {
      wrapper: createRouteWrapper('/settings/profile', '*'),
    });

    expect(state.navigate).not.toHaveBeenCalled();
  });
});
