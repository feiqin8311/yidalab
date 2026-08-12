import { describe, expect, it } from 'vitest';

import {
  DELIVERY_ATTEMPT_STATUSES,
  dingpanDeliveryDedupeKey,
  OPERATION_OUTCOME_STATUSES,
} from './operationOutcome';

describe('operationOutcome', () => {
  it('exposes stable outcome and delivery status sets', () => {
    expect(OPERATION_OUTCOME_STATUSES).toContain('verified');
    expect(OPERATION_OUTCOME_STATUSES).toContain('failed');
    expect(DELIVERY_ATTEMPT_STATUSES).toContain('succeeded');
  });

  it('builds dingpan delivery dedupe keys', () => {
    expect(dingpanDeliveryDedupeKey('op_1')).toBe('op_1:dingpan-report:default:report');
    expect(dingpanDeliveryDedupeKey('op_1', 'dingpan-file', 'space:folder', 'hash')).toBe(
      'op_1:dingpan-file:space:folder:hash',
    );
  });
});
