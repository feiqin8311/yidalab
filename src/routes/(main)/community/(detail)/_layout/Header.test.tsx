// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

const mockNavigate = vi.fn();

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: () => void }) => (
    <button data-testid="back-button" onClick={onClick} />
  ),
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) => (
    <header>
      <div>{left}</div>
      <div>{right}</div>
    </header>
  ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mockNavigate,
}));

vi.mock('@/routes/(main)/community/features/Search', () => ({
  default: () => <div data-testid="community-search" />,
}));

describe('Community detail Header', () => {
  it('renders search bar and back button', () => {
    render(
      <MemoryRouter initialEntries={['/011/community/agent/sad']}>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('community-search')).toBeInTheDocument();
    expect(screen.getByTestId('back-button')).toBeInTheDocument();
  });

  it('navigates back when back button is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/011/community/agent/sad']}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('back-button'));
    expect(mockNavigate).toHaveBeenCalledWith('/community/agent');
  });
});
