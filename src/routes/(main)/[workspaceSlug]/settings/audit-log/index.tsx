'use client';

import { Navigate } from 'react-router';

// Open-source audit log is a cloud stub; send deep-links to members instead of an empty page.
const Page = () => <Navigate replace to="../members" />;

Page.displayName = 'WorkspaceAuditLogPage';

export default Page;
