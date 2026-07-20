'use client';

import { memo } from 'react';

import InstallationConfig from '../../Sidebar/InstallationConfig';

const Installation = memo<{ mobile?: boolean }>(({ mobile: _mobile }) => <InstallationConfig />);

export default Installation;
