'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { Switch, Tooltip, Typography } from 'antd';
import { Trash2Icon, UploadIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMyCompany } from '@/features/Company/hooks';
import { openPublishMarketSkillModal } from '@/features/SkillStore/SkillList/UploadSkillModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { mutate } from '@/libs/swr';
import { companyMarketSkillService } from '@/services/companyMarketSkill';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import Title from '../../../../components/Title';
import { useDetailContext } from '../DetailProvider';

const InstallationConfig = memo(() => {
  const { t } = useTranslation(['discover', 'setting']);
  const { t: tp } = useTranslation('plugin');
  const { t: tc } = useTranslation('common');
  const { identifier, hideContent: initialHideContent } = useDetailContext() as any;
  const { data: company } = useMyCompany();
  const navigate = useWorkspaceAwareNavigate();
  const isManager = company?.role === 'admin' || company?.role === 'owner';
  const [hideContent, setHideContent] = useState(!!initialHideContent);
  const [togglingVisibility, setTogglingVisibility] = useState(false);

  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const installed = useToolStore(agentSkillsSelectors.isAgentSkill(identifier));
  const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
  const [refreshAgentSkills, deleteAgentSkill] = useToolStore((s) => [
    s.refreshAgentSkills,
    s.deleteAgentSkill,
  ]);
  const [installing, setInstalling] = useState(false);

  const handleInstall = useCallback(async () => {
    if (!canCreate || installing || installed || !identifier) return;
    setInstalling(true);
    try {
      await agentSkillService.importFromMarket(identifier);
      await refreshAgentSkills();
    } catch {
      // silently fail
    } finally {
      setInstalling(false);
    }
  }, [canCreate, identifier, installing, installed, refreshAgentSkills]);

  const handleUninstall = useCallback(() => {
    if (!canEdit || !installedSkill) return;
    confirmModal({
      cancelText: tc('cancel'),
      content: tp('store.actions.confirmUninstall'),
      okButtonProps: { danger: true },
      okText: tp('store.actions.uninstall'),
      onOk: async () => {
        await deleteAgentSkill(installedSkill.id);
      },
      title: tp('store.actions.uninstall'),
    });
  }, [canEdit, installedSkill, deleteAgentSkill, tp, tc]);

  const handleUnpublish = useCallback(() => {
    if (!identifier) return;
    confirmModal({
      cancelText: t('common:cancel'),
      content: t('setting:marketSkillModal.unpublishConfirm'),
      okButtonProps: { danger: true },
      okText: t('setting:marketSkillModal.unpublish'),
      onOk: async () => {
        await companyMarketSkillService.delete(identifier);
        navigate('/community/skill');
      },
      title: t('setting:marketSkillModal.unpublish'),
    });
  }, [identifier, navigate, t]);
  const refreshMarketSkill = useCallback(
    () =>
      mutate(
        (key) =>
          Array.isArray(key) &&
          (key[0] === 'discover:skillDetail' || key[0] === 'discover:skillList'),
      ),
    [],
  );
  const handleToggleVisibility = useCallback(
    async (checked: boolean) => {
      if (!identifier || togglingVisibility) return;
      setTogglingVisibility(true);
      try {
        await companyMarketSkillService.updateSkillVisibility({
          hideContent: checked,
          identifier,
        });
        setHideContent(checked);
        await refreshMarketSkill();
      } finally {
        setTogglingVisibility(false);
      }
    },
    [identifier, togglingVisibility, refreshMarketSkill],
  );

  return (
    <Flexbox gap={12}>
      <Title>{t('skills.details.sidebar.installationConfig')}</Title>
      {identifier && (
        <Flexbox style={{ marginBottom: 8 }}>
          {installed ? (
            <Button block danger disabled={!canEdit} onClick={handleUninstall}>
              {tp('store.actions.uninstall')}
            </Button>
          ) : (
            <Button
              block
              disabled={!canCreate}
              loading={installing}
              type="primary"
              onClick={handleInstall}
            >
              {tp('store.actions.install')}
            </Button>
          )}
        </Flexbox>
      )}
      {isManager && identifier && (
        <>
          <Flexbox horizontal gap={8}>
            <Button
              icon={<UploadIcon />}
              onClick={() =>
                openPublishMarketSkillModal({ identifier, onSuccess: refreshMarketSkill })
              }
            >
              {t('setting:marketSkillModal.update')}
            </Button>
            <Button danger icon={<Trash2Icon />} onClick={handleUnpublish} />
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            style={{ padding: '4px 0' }}
          >
            <Flexbox horizontal align={'center'} gap={6}>
              <Typography.Text style={{ fontSize: 13 }}>隐藏 SKILL.md</Typography.Text>
            </Flexbox>
            <Tooltip title={'开启后，普通成员将无法查看 SKILL.md 具体内容，仅可见摘要描述'}>
              <Switch
                checked={hideContent}
                loading={togglingVisibility}
                size={'small'}
                onChange={handleToggleVisibility}
              />
            </Tooltip>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

export default InstallationConfig;
