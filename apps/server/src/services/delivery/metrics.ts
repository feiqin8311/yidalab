import debug from 'debug';

const log = debug('delivery:metrics');

export type DeliveryMetricName =
  | 'enqueue'
  | 'claim'
  | 'succeeded'
  | 'failed'
  | 'redrive'
  | 'pending_age_ms'
  | 'drain_batch'
  | 'latency_ms'
  | 'dead_letter';

/**
 * Structured delivery metrics (scrape-friendly). OTel can wrap later.
 */
export function recordDeliveryMetric(
  name: DeliveryMetricName,
  value: number,
  labels: Record<string, string | number | undefined> = {},
): void {
  const flat = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const line = `[delivery.metric] ${name}=${value}${flat ? ` ${flat}` : ''}`;
  log(line);
  if (
    name === 'failed' ||
    name === 'pending_age_ms' ||
    name === 'dead_letter' ||
    (name === 'succeeded' && value > 0)
  ) {
    console.info(line);
  }
}
