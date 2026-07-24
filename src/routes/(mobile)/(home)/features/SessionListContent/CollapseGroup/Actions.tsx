import { type DropdownMenuProps, type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { MoreVertical, PencilLine, Settings2, Trash } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionStore } from '@/store/session';

interface ActionsProps extends Pick<DropdownMenuProps, 'onOpenChange'> {
  id?: string;
  isCustomGroup?: boolean;
  isPinned?: boolean;
  openConfigModal: () => void;
  openRenameModal?: () => void;
}

type ItemOfType<T> = T extends (infer Item)[] ? Item : never;
type MenuItemType = ItemOfType<MenuProps['items']>;

/**
 * YidaLab product hold: no "new agent" / "new group chat" from session group menus.
 * Mobile createSession used to spawn workspace-public empty-title agents.
 */
const Actions = memo<ActionsProps>(
  ({ id, openRenameModal, openConfigModal, onOpenChange, isCustomGroup }) => {
    const { t } = useTranslation(['chat', 'common']);
    const isMobile = useIsMobile();
    const [removeSessionGroup] = useSessionStore((s) => [s.removeSessionGroup]);

    const sessionGroupConfigPublicItem: MenuItemType = useMemo(
      () => ({
        icon: <Icon icon={Settings2} />,
        key: 'config',
        label: t('sessionGroup.config'),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          openConfigModal();
        },
      }),
      [openConfigModal, t],
    );

    const customGroupItems: MenuProps['items'] = useMemo(
      () => [
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('sessionGroup.rename'),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            openRenameModal?.();
          },
        },
        sessionGroupConfigPublicItem,
        {
          type: 'divider',
        },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            confirmModal({
              cancelText: t('cancel', { ns: 'common' }),
              content: t('sessionGroup.confirmRemoveGroupAlert'),
              okButtonProps: { danger: true },
              okText: t('delete', { ns: 'common' }),
              onOk: async () => {
                if (!id) return;
                await removeSessionGroup(id);
              },
              title: t('delete', { ns: 'common' }),
            });
          },
        },
      ],
      [id, openRenameModal, removeSessionGroup, sessionGroupConfigPublicItem, t],
    );

    const defaultItems: MenuProps['items'] = useMemo(
      () => [sessionGroupConfigPublicItem],
      [sessionGroupConfigPublicItem],
    );

    const menuItems = useMemo(
      () => (isCustomGroup ? customGroupItems : defaultItems),
      [isCustomGroup, customGroupItems, defaultItems],
    );

    return (
      <DropdownMenu items={menuItems} onOpenChange={onOpenChange}>
        <ActionIcon
          active={isMobile ? true : false}
          icon={MoreVertical}
          size={{ blockSize: 22, size: 16 }}
          style={{ background: isMobile ? 'transparent' : '', marginRight: -8 }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
      </DropdownMenu>
    );
  },
);

export default Actions;
