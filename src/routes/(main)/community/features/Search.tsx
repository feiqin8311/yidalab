'use client';

import { type SearchBarProps } from '@lobehub/ui';
import { SearchBar } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { withSuspense } from '@/components/withSuspense';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname, useQuery } from '@/libs/router/navigation';

const prefixCls = 'ant';

/** List tabs that have a `/community/<tab>` search destination. */
const COMMUNITY_SEARCH_TABS = new Set(['agent', 'skill', 'mcp']);

export const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    box-shadow: ${cssVar.boxShadow};
  `,
  bar: css`
    .${prefixCls}-input-group-wrapper {
      padding: 0;
    }
  `,
}));

interface StoreSearchBarProps extends SearchBarProps {
  mobile?: boolean;
}

const Search = memo<StoreSearchBarProps>(() => {
  const { t } = useTranslation('discover');
  const pathname = usePathname();
  const { q } = useQuery() as { q?: string };
  const router = useQueryRoute();
  const [word, setWord] = useState<string>(q || '');
  // Workspace URLs are `/:workspaceSlug/community/<tab>/...` — don't use fixed index.
  const segments = pathname.split('/').filter(Boolean);
  const communityIndex = segments.indexOf('community');
  const tab = communityIndex >= 0 ? segments[communityIndex + 1] : undefined;
  const activeTab = tab && COMMUNITY_SEARCH_TABS.has(tab) ? tab : 'agent';
  const handleSearch = (value: string) => {
    router.push(urlJoin('/community', activeTab), {
      query: value ? { q: value } : {},
      replace: true,
    });
  };

  return (
    <SearchBar
      data-testid="search-bar"
      defaultValue={q}
      placeholder={t('search.placeholder')}
      value={word}
      variant={'borderless'}
      style={{
        width: '100%',
      }}
      onSearch={handleSearch}
      onInputChange={(v) => {
        setWord(v);
        if (!v) handleSearch('');
      }}
    />
  );
});

export default withSuspense(Search);
