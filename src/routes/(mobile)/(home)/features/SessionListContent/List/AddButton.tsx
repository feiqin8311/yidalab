'use client';

import { memo } from 'react';

interface AddButtonProps {
  groupId?: string;
}

// Temporary product hold: agent creation is disabled for YidaLab (align desktop).
// Mobile createSession previously spawned workspace-public "Untitled" agents.
const AddButton = memo<AddButtonProps>(() => null);

export default AddButton;
