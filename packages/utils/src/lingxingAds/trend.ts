import { asNumber } from './format';
import type { CompareBlock, TrendLabel } from './types';

export type AcosDirection = '变好' | '变差' | '持平';

/**
 * ACoS direction: lower is better.
 * Zero rules (V7):
 * - prev=0 current≠0 → 变好
 * - prev≠0 current=0 → 变差
 * - both 0 → 持平
 */
export const acosDirection = (
  current: number | null | undefined,
  previous: number | null | undefined,
): AcosDirection | null => {
  const cur = asNumber(current);
  const prev = asNumber(previous);
  if (cur === null || prev === null) return null;
  if (prev === 0 && cur !== 0) return '变好';
  if (prev !== 0 && cur === 0) return '变差';
  if (prev === 0 && cur === 0) return '持平';
  if (cur < prev) return '变好';
  if (cur > prev) return '变差';
  return '持平';
};

const isWorse = (d: AcosDirection | null) => d === '变差';
const isBetterOrFlat = (d: AcosDirection | null) => d === '变好' || d === '持平';

/**
 * V7 fluctuation from 7d + 14d ACoS only.
 * Special: prev 14 has data and current 14 ACoS=0 → 持续变差
 */
export const computeTrendLabel = (
  compare7d?: CompareBlock | null,
  compare14d?: CompareBlock | null,
): TrendLabel => {
  const d7 = acosDirection(compare7d?.current?.acos, compare7d?.previous?.acos);
  const d14 = acosDirection(compare14d?.current?.acos, compare14d?.previous?.acos);

  const cur14 = asNumber(compare14d?.current?.acos);
  const prev14 = asNumber(compare14d?.previous?.acos);
  if (prev14 !== null && prev14 !== 0 && cur14 === 0) return '持续变差';

  if (d7 === null || d14 === null) return '波动较大';

  if (isWorse(d7) && isWorse(d14)) return '持续变差';
  if (isBetterOrFlat(d7) && isBetterOrFlat(d14)) return '持续变好';
  return '波动较大';
};

export const pickTrendLabel = (
  payloadLabel: string | null | undefined,
  compare7d?: CompareBlock | null,
  compare14d?: CompareBlock | null,
): TrendLabel => {
  const computed = computeTrendLabel(compare7d, compare14d);
  const raw = (payloadLabel || '').trim();
  if (
    (raw === '持续变差' || raw === '持续变好' || raw === '波动较大') && // Prefer MCP label when it matches self-check; otherwise use computed.
    raw === computed
  )
    return raw;
  return computed;
};

export const formatConclusionDetail = (
  label: TrendLabel,
  compare7d?: CompareBlock | null,
  compare14d?: CompareBlock | null,
): string => {
  const d7 = acosDirection(compare7d?.current?.acos, compare7d?.previous?.acos);
  const d14 = acosDirection(compare14d?.current?.acos, compare14d?.previous?.acos);
  const cur7 = asNumber(compare7d?.current?.acos);
  const prev7 = asNumber(compare7d?.previous?.acos);
  const cur14 = asNumber(compare14d?.current?.acos);
  const prev14 = asNumber(compare14d?.previous?.acos);

  const pct = (n: number | null) => (n === null ? '数据缺失' : `${(n * 100).toFixed(2)}%`);
  const dir = (d: AcosDirection | null) => d || '未知';

  return `${label}（近7d ACoS ${pct(cur7)} ${dir(d7)} 前7d ${pct(prev7)}；近14d ACoS ${pct(cur14)} ${dir(d14)} 前14d ${pct(prev14)}）`;
};
