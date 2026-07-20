import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  showAiImage: true,
  showMarket: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/config/routes', () => ({
  getRouteById: (id: string) => ({
    icon: () => id,
  }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: GlobalStateMock) => unknown) =>
    selector({ toggleCommandMenu: vi.fn() }),
}));

vi.mock('@/store/serverConfig', () => {
  return {
    featureFlagsSelectors: {},
    serverConfigSelectors: {
      hidePersonalSettings: (s: { hidePersonalSettings?: boolean }) => !!s.hidePersonalSettings,
    },
    useServerConfigStore: (selector: ((state: Record<string, unknown>) => unknown) | undefined) => {
      const state = {
        hideGitHub: false,
        hidePersonalSettings: false,
        showAiImage: mocks.showAiImage,
        showMarket: mocks.showMarket,
      };
      return typeof selector === 'function' ? selector(state) : state;
    },
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.showAiImage = true;
    mocks.showMarket = true;
  });

  it('keeps Memory visible in personal mode', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).not.toBe(true);
  });

  it('keeps Memory visible in workspace mode', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).not.toBe(true);
  });

  it('shows image generation when ai_image feature flag is on', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const imageItem = result.current.bottomMenuItems.find((item) => item.key === 'image');

    expect(imageItem?.hidden).not.toBe(true);
    expect(imageItem?.url).toBe('/image');
  });

  it('hides image generation when ai_image feature flag is off', async () => {
    mocks.showAiImage = false;

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const imageItem = result.current.bottomMenuItems.find((item) => item.key === 'image');

    expect(imageItem?.hidden).toBe(true);
  });
});
