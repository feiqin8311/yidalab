import { ActionIcon, Block, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { HistoryIcon, RefreshCw, XIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    padding: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  status: css`
    font-size: 12px;
    font-weight: 500;
  `,
}));

type RunRow = {
  attemptCount: number;
  errorMessage: string | null;
  finishedAt: string | Date | null;
  id: string;
  missedCount: number;
  operationId: string | null;
  plannedAt: string | Date;
  startedAt: string | Date | null;
  status: string;
  topicId: string | null;
  trigger: string;
};

const TaskAutomationHistory = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const canWrite = usePermission('agent:update');
  const [rows, setRows] = useState<RunRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const load = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      if (!taskId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await taskService.listAutomationRuns({
          cursor: opts?.cursor,
          id: taskId,
          limit: 20,
          status: statusFilter,
        });
        const data = (res.data ?? []) as RunRow[];
        setRows((prev) => (opts?.append ? [...prev, ...data] : data));
        setCursor(res.nextCursor ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [taskId, statusFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRetry = async (runId: string) => {
    await taskService.retryAutomationRun(runId);
    await load();
  };

  const onCancel = async (runId: string) => {
    await taskService.cancelAutomationRun(runId);
    await load();
  };

  if (!taskId) return null;

  return (
    <Block gap={8} variant="outlined">
      <Flexbox horizontal align="center" gap={8} justify="space-between" padding={12}>
        <Flexbox horizontal align="center" gap={8}>
          <HistoryIcon size={16} />
          <Text weight={600}>{t('taskDetail.automationHistory.title' as never)}</Text>
        </Flexbox>
        <Flexbox horizontal gap={4}>
          {(['', 'failed', 'succeeded', 'pending', 'running'] as const).map((s) => (
            <Button
              key={s || 'all'}
              size="small"
              type={statusFilter === (s || undefined) ? 'primary' : 'default'}
              onClick={() => setStatusFilter(s || undefined)}
            >
              {s || t('taskDetail.automationHistory.all' as never)}
            </Button>
          ))}
        </Flexbox>
      </Flexbox>

      {loading && rows.length === 0 && (
        <div className={styles.empty}>{t('taskDetail.automationHistory.loading' as never)}</div>
      )}
      {error && <div className={styles.empty}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className={styles.empty}>{t('taskDetail.automationHistory.empty' as never)}</div>
      )}

      {rows.map((r) => {
        const planned = dayjs(r.plannedAt).format('YYYY-MM-DD HH:mm');
        const started = r.startedAt ? dayjs(r.startedAt).format('HH:mm:ss') : '—';
        const duration =
          r.startedAt && r.finishedAt
            ? `${Math.max(0, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000))}s`
            : '—';
        return (
          <Flexbox
            horizontal
            align="center"
            className={styles.row}
            gap={12}
            justify="space-between"
            key={r.id}
          >
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8}>
                <span className={styles.status}>{r.status}</span>
                <Text style={{ fontSize: 12 }} type="secondary">
                  {r.trigger}
                </Text>
                {r.missedCount > 0 && (
                  <Text style={{ fontSize: 12 }} type="secondary">
                    missed×{r.missedCount}
                  </Text>
                )}
              </Flexbox>
              <Text style={{ fontSize: 12 }} type="secondary">
                {planned} · start {started} · {duration} · try {r.attemptCount}
              </Text>
              {r.errorMessage && (
                <Text style={{ fontSize: 12 }} type="danger">
                  {r.errorMessage}
                </Text>
              )}
            </Flexbox>
            {canWrite && (
              <Flexbox horizontal gap={4}>
                {(r.status === 'failed' || r.status === 'skipped') && (
                  <ActionIcon
                    icon={RefreshCw}
                    size="small"
                    title={t('taskDetail.automationHistory.retry' as never)}
                    onClick={() => void onRetry(r.id)}
                  />
                )}
                {r.status === 'pending' && (
                  <ActionIcon
                    icon={XIcon}
                    size="small"
                    title={t('taskDetail.automationHistory.cancel' as never)}
                    onClick={() => void onCancel(r.id)}
                  />
                )}
              </Flexbox>
            )}
          </Flexbox>
        );
      })}

      {cursor && (
        <Flexbox padding={12}>
          <Button
            loading={loading}
            size="small"
            onClick={() => void load({ append: true, cursor })}
          >
            {t('taskDetail.automationHistory.loadMore' as never)}
          </Button>
        </Flexbox>
      )}
    </Block>
  );
});

export default TaskAutomationHistory;
