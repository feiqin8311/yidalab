'use client';

import { useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceLoading } from '@/business/client/hooks/useIsWorkspaceLoading';
import { useSilentSwitchWorkspace } from '@/business/client/hooks/useSwitchWorkspace';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';

/**
 * Top-level route segments that share the namespace with `:workspaceSlug`.
 * Anything starting with one of these is NOT a workspace slug — even if the
 * first segment happens to resemble one.
 *
 * Kept in sync with `sharedMainAreaChildren` (paths) + the personal-only list
 * in router configs. If you add a new root path segment, add it here too.
 */
const RESERVED_FIRST_SEGMENTS = new Set([
  // Shared (mirrored under /:workspaceSlug too):
  'agent',
  'group',
  'community',
  'company',
  'memory',
  'page',
  'resource',
  'image',
  'video',
  'eval',
  'tasks',
  'task',
  // Personal-only:
  'settings',
  'onboarding',
  'me',
  'share',
  'devtools',
  'desktop-onboarding',
]);

/**
 * Main product surfaces that must live under `/{companySlug}/...` when the
 * user belongs to a company. Personal-only routes (settings, invite, share…)
 * stay unprefixed so they keep working outside workspace scope.
 */
const COMPANY_SCOPED_FIRST_SEGMENTS = new Set([
  'agent',
  'group',
  'community',
  'memory',
  'page',
  'resource',
  'image',
  'video',
  'eval',
  'tasks',
  'task',
]);

const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

const parseFirstSegment = (pathname: string): string | null => {
  const match = pathname.match(FIRST_SEGMENT_REGEX);
  return match ? match[1] : null;
};

/**
 * Whether `pathname`'s first segment could be an (as-yet-unresolved) workspace
 * slug — i.e. it's present and not one of the reserved root segments.
 *
 * Top-level rendering only needs to block on the workspace list (to avoid a
 * false 404 / wrong-scope paint) when this is `true`. On reserved routes
 * (`/`, `/agent/...`, `/settings/...`) the list isn't required to render, so
 * callers can paint the page while the current company hydrates in the background.
 */
export const isWorkspaceSlugCandidatePath = (pathname: string): boolean => {
  const first = parseFirstSegment(pathname);
  return !!first && !RESERVED_FIRST_SEGMENTS.has(first);
};

const shouldPrefixWithCompanySlug = (pathname: string, first: string | null) => {
  if (!first) return true; // `/`
  return COMPANY_SCOPED_FIRST_SEGMENTS.has(first);
};

/**
 * URL is the source of truth for workspace context.
 *
 * - `/{slug}/...` where `slug` is a known workspace → activate that workspace
 * - With a company: bare main surfaces (`/`, `/agent/...`) redirect to
 *   `/{companySlug}/...` so inbox/builtin agents always resolve in company scope
 * - `/settings/...` etc. stay unprefixed but still activate the company for API headers
 * - `/{unknown}/...` (slug not in workspaces) → leave store alone so
 *   `WorkspaceSlugBoundary` can render its 404
 */
export const useWorkspaceUrlSync = (): void => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const activeId = useActiveWorkspaceId();
  const isLoading = useIsWorkspaceLoading();
  // URL is a passive source, not an explicit user intent — use the silent
  // variant so refreshing or following a `/{slug}` link is not treated as
  // a user-driven switch.
  const { switchWorkspace } = useSilentSwitchWorkspace();

  // `useLayoutEffect` (not `useEffect`) so the workspace switch is scheduled
  // before the browser paints. With `useEffect` there is one paintable frame
  // between `isWorkspaceLoading: false` and `switchWorkspace()` running, which
  // causes downstream consumers (e.g. `WorkspaceContextSlot`) to briefly see
  // `isContextReady === true` and unhide stale children before the splash
  // re-asserts itself.
  useLayoutEffect(() => {
    // Defer until the workspace list has loaded so we don't briefly flip the
    // store to "personal" on first paint of a `/{slug}` URL.
    if (isLoading) return;

    const first = parseFirstSegment(pathname);

    if (first && !RESERVED_FIRST_SEGMENTS.has(first)) {
      const ws = workspaces.find((w) => w.slug === first);
      if (ws) {
        if (activeId !== ws.id) void switchWorkspace(ws.id);
        return;
      }
      // Unknown slug — let `WorkspaceSlugBoundary` show 404; don't touch the
      // active workspace.
      return;
    }

    const defaultWorkspace = workspaces[0];
    if (!defaultWorkspace) return;

    if (activeId !== defaultWorkspace.id) void switchWorkspace(defaultWorkspace.id);

    // Company-first: keep chat/home surfaces under the company slug so the
    // inbox agent is always the workspace-scoped one, not the personal copy.
    if (shouldPrefixWithCompanySlug(pathname, first)) {
      const suffix = pathname === '/' ? '' : pathname;
      const target = `/${defaultWorkspace.slug}${suffix}`;
      if (pathname !== target) navigate(target, { replace: true });
    }
  }, [pathname, workspaces, isLoading, activeId, switchWorkspace, navigate]);
};
