import { describe, expect, it } from 'vitest';

import { SIDEBAR_SPACER_ID } from '@/store/global/selectors/systemStatus';

import { getAvailableSidebarItems, getSortableSidebarItemIds } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('keeps Memory available in personal mode', () => {
    const items = getAvailableSidebarItems(false);

    expect(items.some((item) => item.id === 'memory')).toBe(true);
  });

  it('keeps Memory available in workspace mode customization', () => {
    const items = getAvailableSidebarItems(true);

    expect(items.some((item) => item.id === 'memory')).toBe(true);
  });

  it('keeps the spacer in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false).has(SIDEBAR_SPACER_ID)).toBe(true);
    expect(getSortableSidebarItemIds(true).has(SIDEBAR_SPACER_ID)).toBe(true);
  });

  it('sortable ids include Memory in both modes', () => {
    expect(getSortableSidebarItemIds(false).has('memory')).toBe(true);
    expect(getSortableSidebarItemIds(true).has('memory')).toBe(true);
  });

  it('shows feedback only in workspace mode', () => {
    expect(getAvailableSidebarItems(false).some((item) => item.id === 'feedback')).toBe(false);
    expect(getAvailableSidebarItems(true).some((item) => item.id === 'feedback')).toBe(true);
  });
});
