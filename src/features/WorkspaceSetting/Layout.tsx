'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, memo } from 'react';
import { Outlet } from 'react-router';

import Container from './Container';
import SideBar from './SideBar';

/**
 * Bare workspace settings shell — sidebar + outlet, no content padding.
 * Use this when a child route owns its own full-bleed layout (e.g. Provider).
 */
const WorkspaceSettingsLayout: FC = memo(() => {
  return (
    <>
      <SideBar />
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
        <Outlet />
      </Flexbox>
    </>
  );
});

WorkspaceSettingsLayout.displayName = 'WorkspaceSettingsLayout';

/**
 * Padded content layout — wraps the outlet in a centered, max-width
 * `WorkspaceSettingsContainer`. Mount this above routes that follow the
 * standard "header + form" page pattern (general, members, billing, etc.).
 */
const WorkspaceSettingsContentLayout: FC = memo(() => {
  return (
    <Container maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
      <Outlet />
    </Container>
  );
});

WorkspaceSettingsContentLayout.displayName = 'WorkspaceSettingsContentLayout';

export { WorkspaceSettingsContentLayout };

export default WorkspaceSettingsLayout;
