import { Command } from 'cmdk';
import { FilePen, LibraryBig, MessageSquarePlusIcon, Monitor } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavigableRoutes, getRouteById } from '@/config/routes';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useCommandMenuContext } from './CommandMenuContext';
import { CommandItem } from './components';
import ContextCommands from './ContextCommands';
import { useCommandMenu } from './useCommandMenu';

const MainMenu = memo(() => {
  const { pathname, menuContext, setPages, pages } = useCommandMenuContext();
  const { t } = useTranslation('common');
  const { allowed: canCreate } = usePermission('create_content');
  // While the first send from the new-topic view is still creating the real
  // topic, openNewTopicOrSaveTopic is a no-op — disable the command instead of
  // letting it close the palette as a false success (same as the sidebar entry).
  const isNewTopicSendInFlight = useChatStore(topicSelectors.isNewTopicSendInFlight);

  const { handleCreateTopic, handleCreateLibrary, handleCreatePage, handleNavigate } =
    useCommandMenu();

  return (
    <>
      <ContextCommands />

      <Command.Group>
        {/* Temporary product hold: agent creation is disabled for YidaLab. */}

        {menuContext === 'agent' && (
          <CommandItem
            disabled={!canCreate || isNewTopicSendInFlight}
            icon={<MessageSquarePlusIcon />}
            unpinned={menuContext !== 'agent'}
            value="create new topic"
            onSelect={handleCreateTopic}
          >
            {t('cmdk.newTopic')}
          </CommandItem>
        )}

        <CommandItem
          disabled={!canCreate}
          icon={<FilePen />}
          value="create new page"
          onSelect={handleCreatePage}
        >
          {t('cmdk.newPage')}
        </CommandItem>

        <CommandItem
          disabled={!canCreate}
          icon={<LibraryBig />}
          unpinned={menuContext !== 'resource'}
          value="create new library"
          onSelect={handleCreateLibrary}
        >
          {t('cmdk.newLibrary')}
        </CommandItem>

        {menuContext !== 'settings' &&
          (() => {
            const settingsRoute = getRouteById('settings');
            const SettingsIcon = settingsRoute?.icon;
            const keywords = settingsRoute?.keywordsKey
              ? t(settingsRoute.keywordsKey as any).split(' ')
              : settingsRoute?.keywords;
            return (
              <CommandItem
                icon={SettingsIcon && <SettingsIcon />}
                keywords={keywords}
                value="settings"
                onSelect={() => handleNavigate(settingsRoute?.path || '/settings')}
              >
                {t('cmdk.settings')}
              </CommandItem>
            );
          })()}

        <CommandItem
          icon={<Monitor />}
          value="theme"
          onSelect={() => setPages([...pages, 'theme'])}
        >
          {t('cmdk.theme')}
        </CommandItem>
      </Command.Group>

      <Command.Group heading={t('cmdk.navigate')}>
        {getNavigableRoutes().map((route) => {
          const RouteIcon = route.icon;
          const keywords = route.keywordsKey
            ? t(route.keywordsKey as any).split(' ')
            : route.keywords;
          return (
            !pathname?.startsWith(route.pathPrefix) && (
              <CommandItem
                icon={<RouteIcon />}
                key={route.id}
                keywords={keywords}
                value={route.id}
                onSelect={() => handleNavigate(route.path)}
              >
                {t(route.cmdkKey as any)}
              </CommandItem>
            )
          );
        })}
      </Command.Group>
    </>
  );
});

MainMenu.displayName = 'MainMenu';

export default MainMenu;
