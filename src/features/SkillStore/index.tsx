'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { SkillStoreContent } from './SkillStoreContent';

export const createSkillStoreModal = () =>
  createModal({
    content: <SkillStoreContent />,
    footer: null,
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
