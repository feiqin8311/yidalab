'use client';

import { type PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';

import { useIsWorkspaceLoading } from './hooks/useIsWorkspaceLoading';
import { useWorkspaces } from './hooks/useWorkspaces';

const COMPANY_REQUIRED_REDIRECT = '/settings/company';

export const canAccessWithoutCompany = (pathname: string) =>
  pathname === '/settings' ||
  pathname.startsWith('/settings/') ||
  pathname.startsWith('/company/invite/');

export default function WorkspaceContextSlot({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  const workspaces = useWorkspaces();
  const isLoading = useIsWorkspaceLoading();

  if (isLoading) return <Loading debugId="WorkspaceContextSlot" />;
  if (workspaces.length === 0 && !canAccessWithoutCompany(pathname)) {
    return <Navigate replace to={COMPANY_REQUIRED_REDIRECT} />;
  }

  return children;
}
