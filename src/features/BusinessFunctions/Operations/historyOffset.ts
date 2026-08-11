/** Clamp list offset after total shrinks; skip when total unknown (loading). */
export const clampHistoryOffset = (
  offset: number,
  total: number | undefined,
  pageSize: number,
  ready: boolean,
): number => {
  if (!ready || total === undefined) return offset;
  if (total <= 0) return 0;
  const maxOffset = Math.floor((total - 1) / pageSize) * pageSize;
  return Math.min(offset, maxOffset);
};
