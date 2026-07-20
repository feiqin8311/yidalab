'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { App, Radio, Spin } from 'antd';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import ImperativeModal from '@/components/ImperativeModal';
import { lambdaClient } from '@/libs/trpc/client';
import { fileService } from '@/services/file';
import { knowledgeBaseService } from '@/services/knowledgeBase';

export type ResourceShareKind = 'file' | 'knowledge_base';

export interface ResourceShareModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
  resourceId: string;
  resourceType: ResourceShareKind;
  /** Current visibility of the resource. */
  visibility?: 'private' | 'public' | null;
}

type ShareMode = 'private' | 'workspace' | 'specific';

type GrantDraft = { granteeId: string; granteeType: 'user' | 'department' };

/**
 * Share dialog: only me / whole company / specific people & departments.
 * Creator-only mutation path (server-enforced).
 */
const ResourceShareModal = memo<ResourceShareModalProps>(
  ({ open, onClose, onSuccess, resourceId, resourceType, visibility }) => {
    const { t } = useTranslation('chat');
    const { message } = App.useApp();
    const workspaceId = useActiveWorkspaceId();

    const [mode, setMode] = useState<ShareMode>('private');
    const [userIds, setUserIds] = useState<string[]>([]);
    const [departmentIds, setDepartmentIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [memberOptions, setMemberOptions] = useState<Array<{ label: string; value: string }>>([]);
    const [deptOptions, setDeptOptions] = useState<Array<{ label: string; value: string }>>([]);

    const load = useCallback(async () => {
      if (!open || !workspaceId || !resourceId) return;
      setLoading(true);
      try {
        const [membersRes, deptsRes, grants] = await Promise.all([
          lambdaClient.company.listMembers.query({ workspaceId }),
          lambdaClient.company.listDepartments.query({ workspaceId }),
          resourceType === 'file'
            ? fileService.listFileGrants(resourceId)
            : knowledgeBaseService.listKnowledgeBaseGrants(resourceId),
        ]);

        const members = (membersRes as any)?.data ?? membersRes ?? [];
        const depts = (deptsRes as any)?.data ?? deptsRes ?? [];

        setMemberOptions(
          (Array.isArray(members) ? members : []).map((m: any) => ({
            label: m.username || m.email || m.userId,
            value: m.userId,
          })),
        );
        setDeptOptions(
          (Array.isArray(depts) ? depts : []).map((d: any) => ({
            label: d.name,
            value: d.id,
          })),
        );

        const grantList = Array.isArray(grants) ? grants : [];
        const nextUsers = grantList
          .filter((g: any) => g.granteeType === 'user')
          .map((g: any) => g.granteeId as string);
        const nextDeps = grantList
          .filter((g: any) => g.granteeType === 'department')
          .map((g: any) => g.granteeId as string);

        setUserIds(nextUsers);
        setDepartmentIds(nextDeps);

        if (visibility === 'public') {
          setMode('workspace');
        } else if (nextUsers.length > 0 || nextDeps.length > 0) {
          setMode('specific');
        } else {
          setMode('private');
        }
      } catch (e) {
        console.error('[ResourceShareModal] load failed', e);
        message.error(t('resources.share.error' as never));
      } finally {
        setLoading(false);
      }
    }, [open, workspaceId, resourceId, resourceType, visibility, message, t]);

    useEffect(() => {
      void load();
    }, [load]);

    const handleSave = useCallback(async () => {
      if (!workspaceId) return;
      setSaving(true);
      try {
        if (mode === 'workspace') {
          if (resourceType === 'file') {
            await fileService.setFileVisibility(resourceId, 'public');
          } else {
            await knowledgeBaseService.setKnowledgeBaseVisibility(resourceId, 'public');
          }
        } else {
          const grants: GrantDraft[] =
            mode === 'specific'
              ? [
                  ...userIds.map((id) => ({ granteeId: id, granteeType: 'user' as const })),
                  ...departmentIds.map((id) => ({
                    granteeId: id,
                    granteeType: 'department' as const,
                  })),
                ]
              : [];

          if (resourceType === 'file') {
            if (visibility === 'public') {
              await fileService.setFileVisibility(resourceId, 'private');
            }
            await fileService.setFileGrants(resourceId, grants);
          } else {
            if (visibility === 'public') {
              await knowledgeBaseService.setKnowledgeBaseVisibility(resourceId, 'private');
            }
            await knowledgeBaseService.setKnowledgeBaseGrants(resourceId, grants);
          }
        }

        message.success(t('resources.share.success' as never));
        onSuccess?.();
        onClose();
      } catch (e) {
        console.error('[ResourceShareModal] save failed', e);
        message.error(t('resources.share.error' as never));
      } finally {
        setSaving(false);
      }
    }, [
      workspaceId,
      mode,
      resourceType,
      resourceId,
      userIds,
      departmentIds,
      visibility,
      message,
      t,
      onSuccess,
      onClose,
    ]);

    const modeOptions = useMemo(
      () => [
        { label: t('resources.share.modePrivate' as never), value: 'private' as const },
        { label: t('resources.share.modeWorkspace' as never), value: 'workspace' as const },
        { label: t('resources.share.modeSpecific' as never), value: 'specific' as const },
      ],
      [t],
    );

    return (
      <ImperativeModal
        centered
        confirmLoading={saving}
        okText={t('resources.share.save' as never)}
        open={open}
        title={t('resources.share.title' as never)}
        width={480}
        onCancel={onClose}
        onOk={handleSave}
      >
        {loading ? (
          <Flexbox align="center" justify="center" style={{ minHeight: 160 }}>
            <Spin />
          </Flexbox>
        ) : (
          <Flexbox gap={16} style={{ paddingBlock: 8 }}>
            <Radio.Group
              optionType="button"
              options={modeOptions}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            />

            {mode === 'specific' && (
              <Flexbox gap={12}>
                <div>
                  <Text style={{ display: 'block', marginBottom: 6 }} type="secondary">
                    {t('resources.share.people' as never)}
                  </Text>
                  <Select
                    allowClear
                    mode="multiple"
                    options={memberOptions}
                    placeholder={t('resources.share.people' as never)}
                    style={{ width: '100%' }}
                    value={userIds}
                    onChange={setUserIds}
                  />
                </div>
                <div>
                  <Text style={{ display: 'block', marginBottom: 6 }} type="secondary">
                    {t('resources.share.departments' as never)}
                  </Text>
                  <Select
                    allowClear
                    mode="multiple"
                    options={deptOptions}
                    placeholder={t('resources.share.departments' as never)}
                    style={{ width: '100%' }}
                    value={departmentIds}
                    onChange={setDepartmentIds}
                  />
                </div>
              </Flexbox>
            )}
          </Flexbox>
        )}
      </ImperativeModal>
    );
  },
);

ResourceShareModal.displayName = 'ResourceShareModal';

export default ResourceShareModal;
