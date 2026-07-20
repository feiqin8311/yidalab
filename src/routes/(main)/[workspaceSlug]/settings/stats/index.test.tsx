/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceStatsSetting from './index';

const useFetchWorkspaceMembersMock = vi.hoisted(() => vi.fn());
const useIsWorkspaceAdminMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/business/client/hooks/useFetchWorkspaceMembers', () => ({
  useFetchWorkspaceMembers: useFetchWorkspaceMembersMock,
}));

vi.mock('@/business/client/hooks/useIsWorkspaceAdmin', () => ({
  useIsWorkspaceAdmin: useIsWorkspaceAdminMock,
}));

vi.mock('@/routes/(main)/settings/stats/features/overview/WorkspaceWelcome', () => ({
  default: () => <div>Workspace Welcome</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      key === 'usage.activeModels.removedUserName' ? `${options?.name} (Removed)` : key,
  }),
}));

vi.mock('@/routes/(main)/settings/stats', () => ({
  default: ({
    enableUserDimension,
    resolveUser,
  }: {
    enableUserDimension?: boolean;
    resolveUser?: (userId: string) => { avatar?: string | null; name: string };
  }) => {
    if (!resolveUser) {
      return (
        <div>
          <span>self-only</span>
          <span>enableUserDimension={String(!!enableUserDimension)}</span>
        </div>
      );
    }
    const activeUser = resolveUser('user-1');
    const removedUser = resolveUser('user-2');
    const noAvatarUser = resolveUser('user-3');

    return (
      <div>
        <span>{activeUser.name}</span>
        <span>{activeUser.avatar}</span>
        <span>{removedUser.name}</span>
        <span>{noAvatarUser.name}</span>
        <span>enableUserDimension={String(!!enableUserDimension)}</span>
      </div>
    );
  },
}));

// Flat shape matches company.listMembers (real API).
const workspaceMembers = [
  {
    avatar: 'https://example.com/avatar.png',
    deletedAt: null,
    email: 'ada@example.com',
    userId: 'user-1',
    username: 'ada',
  },
  {
    avatar: null,
    deletedAt: new Date('2026-05-27T00:00:00.000Z'),
    email: null,
    userId: 'user-2',
    username: 'grace',
  },
  {
    avatar: null,
    deletedAt: null,
    email: 'alan@example.com',
    userId: 'user-3',
    username: null,
  },
];

describe('WorkspaceStatsSetting', () => {
  it('resolves display names from flat company member rows when admin', () => {
    useIsWorkspaceAdminMock.mockReturnValue(true);
    useFetchWorkspaceMembersMock.mockReturnValue({ data: workspaceMembers });

    render(<WorkspaceStatsSetting />);

    expect(useFetchWorkspaceMembersMock).toHaveBeenCalledWith({ includeDeleted: true });
    // Prefer username, then email (not opaque userId).
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/avatar.png')).toBeInTheDocument();
    expect(screen.getByText('grace (Removed)')).toBeInTheDocument();
    expect(screen.getByText('alan@example.com')).toBeInTheDocument();
    expect(screen.getByText('enableUserDimension=true')).toBeInTheDocument();
  });

  it('also resolves nested user profiles when present', () => {
    useIsWorkspaceAdminMock.mockReturnValue(true);
    useFetchWorkspaceMembersMock.mockReturnValue({
      data: [
        {
          deletedAt: null,
          user: {
            avatar: 'https://example.com/nested.png',
            email: 'nested@example.com',
            username: 'nested-user',
          },
          userId: 'user-1',
        },
        {
          deletedAt: new Date('2026-05-27T00:00:00.000Z'),
          user: { avatar: null, email: null, username: 'grace' },
          userId: 'user-2',
        },
        {
          deletedAt: null,
          user: { avatar: null, email: 'only-email@example.com', username: null },
          userId: 'user-3',
        },
      ],
    });

    render(<WorkspaceStatsSetting />);

    expect(screen.getByText('nested-user')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/nested.png')).toBeInTheDocument();
    expect(screen.getByText('grace (Removed)')).toBeInTheDocument();
    expect(screen.getByText('only-email@example.com')).toBeInTheDocument();
  });

  it('hides by-user dimension for ordinary members', () => {
    useIsWorkspaceAdminMock.mockReturnValue(false);
    useFetchWorkspaceMembersMock.mockReturnValue({ data: workspaceMembers });

    render(<WorkspaceStatsSetting />);

    expect(screen.getByText('self-only')).toBeInTheDocument();
    expect(screen.getByText('enableUserDimension=false')).toBeInTheDocument();
  });
});
