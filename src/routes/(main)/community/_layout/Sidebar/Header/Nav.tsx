'use client';

import { Flexbox } from '@lobehub/ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePathname } from '@/libs/router/navigation';
import { DiscoverTab } from '@/types/discover';

const Nav = memo(() => {
  const pathname = usePathname();
  const { t } = useTranslation('discover');
  const items = [
    { icon: Bot, key: DiscoverTab.Assistants, title: t('tab.assistant'), url: '/community/agent' },
    { icon: SkillsIcon, key: DiscoverTab.Skills, title: t('tab.skill'), url: '/community/skill' },
    { icon: McpIcon, key: DiscoverTab.Mcp, title: 'MCP', url: '/community/mcp' },
  ];

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => (
        <WorkspaceLink key={item.key} to={item.url}>
          <NavItem
            active={pathname.includes(`/community/${item.key}`)}
            icon={item.icon}
            title={item.title}
          />
        </WorkspaceLink>
      ))}
    </Flexbox>
  );
});

export default Nav;
