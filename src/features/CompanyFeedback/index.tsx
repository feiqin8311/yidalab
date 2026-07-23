'use client';

import { Avatar, Block, Empty, Flexbox, Input, Skeleton, Text, TextArea } from '@lobehub/ui';
import { Button, Select, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageSquarePlusIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import ImperativeModal from '@/components/ImperativeModal';
import { useMyCompany } from '@/features/Company/hooks';
import { companyFeedbackService, type CompanyFeedbackStatus } from '@/services/companyFeedback';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { refreshCompanyFeedbackList, useCompanyFeedbackList } from './hooks';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;
    transition: border-color 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorderSecondary};
    }
  `,
  filter: css`
    flex-wrap: wrap;
  `,
  page: css`
    width: 100%;
    max-width: 720px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px 48px;
    padding-inline: 16px;
  `,
  preview: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
}));

type FilterKey = CompanyFeedbackStatus | 'all';

type FeedbackAuthor = {
  avatar?: string | null;
  firstName?: string | null;
  id: string;
  lastName?: string | null;
  username?: string | null;
};

type FeedbackItem = {
  author?: FeedbackAuthor | null;
  content: string;
  createdAt: Date | string;
  id: string;
  status: CompanyFeedbackStatus;
  title: string;
  userId: string;
};

const authorLabel = (author?: FeedbackAuthor | null) => {
  const name = [author?.firstName, author?.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (author?.username) return author.username;
  return author?.id?.slice(0, 8) ?? '—';
};

const formatTime = (value: Date | string) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
};

const CompanyFeedbackPage = memo(() => {
  const { t } = useTranslation('common');
  const workspaceId = useActiveWorkspaceId() ?? undefined;
  const { data: company, isLoading: companyLoading } = useMyCompany();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const isManager = company?.role === 'admin' || company?.role === 'owner';

  const [filter, setFilter] = useState<FilterKey>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FeedbackItem | null>(null);
  const [detail, setDetail] = useState<FeedbackItem | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const { data, isLoading, error, mutate } = useCompanyFeedbackList(workspaceId, filter);
  const items = (data ?? []) as FeedbackItem[];

  const filterOptions = useMemo(
    () =>
      (
        [
          ['all', t('companyFeedback.filter.all')],
          ['pending', t('companyFeedback.filter.pending')],
          ['accepted', t('companyFeedback.filter.accepted')],
          ['declined', t('companyFeedback.filter.declined')],
        ] as const
      ).map(([key, label]) => ({ key, label })),
    [t],
  );

  const statusOptions = useMemo(
    () => [
      { label: t('companyFeedback.filter.pending'), value: 'pending' },
      { label: t('companyFeedback.filter.accepted'), value: 'accepted' },
      { label: t('companyFeedback.filter.declined'), value: 'declined' },
    ],
    [t],
  );

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setFormOpen(true);
  };

  const openEdit = (item: FeedbackItem) => {
    setDetail(null);
    setEditing(item);
    setTitle(item.title);
    setContent(item.content);
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!workspaceId) return;
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (!nextTitle || !nextContent) {
      toast.error(t('companyFeedback.form.required'));
      return;
    }
    try {
      setSaving(true);
      if (editing) {
        await companyFeedbackService.update({
          content: nextContent,
          id: editing.id,
          title: nextTitle,
        });
      } else {
        await companyFeedbackService.create({
          content: nextContent,
          title: nextTitle,
          workspaceId,
        });
      }
      setFormOpen(false);
      await refreshCompanyFeedbackList(workspaceId);
      await mutate();
      toast.success(
        editing ? t('companyFeedback.toast.updated') : t('companyFeedback.toast.created'),
      );
    } catch {
      toast.error(t('companyFeedback.toast.failed'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (item: FeedbackItem) => {
    if (!workspaceId) return;
    try {
      await companyFeedbackService.delete(item.id);
      setDetail(null);
      await refreshCompanyFeedbackList(workspaceId);
      await mutate();
      toast.success(t('companyFeedback.toast.deleted'));
    } catch {
      toast.error(t('companyFeedback.toast.failed'));
    }
  };

  const onStatusChange = async (item: FeedbackItem, status: CompanyFeedbackStatus) => {
    if (!workspaceId || item.status === status) return;
    try {
      setStatusSaving(true);
      await companyFeedbackService.updateStatus({ id: item.id, status });
      setDetail({ ...item, status });
      await refreshCompanyFeedbackList(workspaceId);
      await mutate();
      toast.success(t('companyFeedback.toast.statusUpdated'));
    } catch {
      toast.error(t('companyFeedback.toast.failed'));
    } finally {
      setStatusSaving(false);
    }
  };

  if (!workspaceId && !companyLoading) {
    return (
      <Flexbox align="center" className={styles.page} justify="center" style={{ minHeight: 320 }}>
        <Empty description={t('companyFeedback.companyOnly')} icon={MessageSquarePlusIcon} />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.page} gap={16}>
      <Flexbox horizontal align="center" justify="space-between">
        <Text as="h1" style={{ margin: 0 }} weight={600}>
          {t('companyFeedback.title')}
        </Text>
        <Button type="primary" onClick={openCreate}>
          {t('companyFeedback.create')}
        </Button>
      </Flexbox>

      <Flexbox horizontal className={styles.filter} gap={8}>
        {filterOptions.map((opt) => (
          <Button
            key={opt.key}
            size="small"
            type={filter === opt.key ? 'primary' : 'default'}
            variant={filter === opt.key ? undefined : 'filled'}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label}
          </Button>
        ))}
      </Flexbox>

      {isLoading || companyLoading ? (
        <Flexbox gap={12}>
          <Skeleton.Button active block style={{ height: 96 }} />
          <Skeleton.Button active block style={{ height: 96 }} />
        </Flexbox>
      ) : error ? (
        <Empty description={t('companyFeedback.toast.failed')} />
      ) : items.length === 0 ? (
        <Empty
          description={t('companyFeedback.empty')}
          icon={MessageSquarePlusIcon}
          actions={
            <Button type="primary" onClick={openCreate}>
              {t('companyFeedback.emptyCta')}
            </Button>
          }
        />
      ) : (
        <Flexbox gap={12}>
          {items.map((item) => (
            <Block
              clickable
              className={styles.card}
              key={item.id}
              padding={16}
              variant="outlined"
              onClick={() => setDetail(item)}
            >
              <Flexbox gap={8}>
                <Flexbox horizontal align="center" justify="space-between">
                  <Text weight={600}>{item.title}</Text>
                  <Text fontSize={12} type="secondary">
                    {t(`companyFeedback.filter.${item.status}`)}
                  </Text>
                </Flexbox>
                <Text className={styles.preview} fontSize={13} type="secondary">
                  {item.content}
                </Text>
                <Flexbox horizontal align="center" gap={8}>
                  <Avatar avatar={item.author?.avatar || undefined} size={20} />
                  <Text fontSize={12} type="secondary">
                    {authorLabel(item.author)} · {formatTime(item.createdAt)}
                  </Text>
                </Flexbox>
              </Flexbox>
            </Block>
          ))}
        </Flexbox>
      )}

      <ImperativeModal
        destroyOnHidden
        okButtonProps={{ loading: saving }}
        okText={editing ? t('companyFeedback.detail.edit') : t('companyFeedback.create')}
        open={formOpen}
        title={editing ? t('companyFeedback.detail.edit') : t('companyFeedback.create')}
        onCancel={() => setFormOpen(false)}
        onOk={submitForm}
      >
        <Flexbox gap={12} paddingBlock={8}>
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('companyFeedback.form.title')}
            </Text>
            <Input
              maxLength={120}
              placeholder={t('companyFeedback.form.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('companyFeedback.form.content')}
            </Text>
            <TextArea
              maxLength={5000}
              placeholder={t('companyFeedback.form.contentPlaceholder')}
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      </ImperativeModal>

      <ImperativeModal
        destroyOnHidden
        footer={null}
        open={!!detail}
        title={detail?.title}
        onCancel={() => setDetail(null)}
      >
        {detail && (
          <Flexbox gap={16} paddingBlock={8}>
            <Flexbox horizontal align="center" gap={8} justify="space-between">
              <Flexbox horizontal align="center" gap={8}>
                <Avatar avatar={detail.author?.avatar || undefined} size={24} />
                <Text fontSize={13} type="secondary">
                  {authorLabel(detail.author)} · {formatTime(detail.createdAt)}
                </Text>
              </Flexbox>
              {isManager ? (
                <Select
                  disabled={statusSaving}
                  options={statusOptions}
                  style={{ width: 140 }}
                  value={detail.status}
                  onChange={(value) => onStatusChange(detail, value as CompanyFeedbackStatus)}
                />
              ) : (
                <Text fontSize={12} type="secondary">
                  {t(`companyFeedback.filter.${detail.status}`)}
                </Text>
              )}
            </Flexbox>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{detail.content}</Text>
            <Flexbox horizontal gap={8} justify="flex-end">
              {detail.userId === currentUserId && (
                <Button onClick={() => openEdit(detail)}>{t('companyFeedback.detail.edit')}</Button>
              )}
              {(detail.userId === currentUserId || isManager) && (
                <Button danger onClick={() => onDelete(detail)}>
                  {t('companyFeedback.detail.delete')}
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        )}
      </ImperativeModal>
    </Flexbox>
  );
});

CompanyFeedbackPage.displayName = 'CompanyFeedbackPage';

export default CompanyFeedbackPage;
