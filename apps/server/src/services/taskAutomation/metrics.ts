import debug from 'debug';

const log = debug('task-automation:metrics');

export type AutomationMetricName =
  | 'planned'
  | 'dispatch_latency_ms'
  | 'claim_expired'
  | 'claim_rebound'
  | 'pending_age_ms'
  | 'run_duration_ms'
  | 'failure'
  | 'overdue'
  | 'duplicate_plan'
  | 'operation_bind';

/**
 * Minimal metrics sink for shadow / first-on rollout.
 * Logs structured lines that ops can scrape; OTel can wrap later.
 */
export function recordAutomationMetric(
  name: AutomationMetricName,
  value: number,
  labels: Record<string, string | number | undefined> = {},
): void {
  const flat = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  // Always emit via debug namespace; also console.info for pending-age / claim-expired
  // so shadow deploys surface without DEBUG=* .
  const line = `[task-automation.metric] ${name}=${value}${flat ? ` ${flat}` : ''}`;
  log(line);
  if (
    (name === 'pending_age_ms' || name === 'claim_expired' || name === 'dispatch_latency_ms') &&
    value > 0
  )
    console.info(line);
}
