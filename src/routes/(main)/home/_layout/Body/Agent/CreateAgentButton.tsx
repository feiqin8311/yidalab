'use client';

import { memo } from 'react';

interface CreateAgentButtonProps {
  className?: string;
  groupId?: string;
  visibility?: 'private' | 'public';
}

// Temporary product hold: agent creation is disabled for YidaLab.
const CreateAgentButton = memo<CreateAgentButtonProps>(() => null);

export default CreateAgentButton;
