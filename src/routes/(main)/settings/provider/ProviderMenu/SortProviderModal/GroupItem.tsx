import { ProviderIcon } from '@lobehub/icons';
import { Avatar, Flexbox, SortableList } from '@lobehub/ui';
import { memo } from 'react';

import { type AiProviderListItem } from '@/types/aiProvider';

import { getProviderDisplayName } from '../../features/getProviderDisplayName';

interface GroupItemProps extends AiProviderListItem {
  disabled?: boolean;
}

const GroupItem = memo<GroupItemProps>(({ id, name, source, logo, disabled }) => {
  const displayName = getProviderDisplayName({ id, name });

  return (
    <>
      <Flexbox horizontal gap={8}>
        {source === 'custom' && logo ? (
          <Avatar
            alt={displayName}
            avatar={logo}
            shape={'square'}
            size={24}
            style={{ borderRadius: 6 }}
          />
        ) : (
          <ProviderIcon provider={id} size={24} style={{ borderRadius: 6 }} type={'avatar'} />
        )}
        {displayName}
      </Flexbox>
      {!disabled && <SortableList.DragHandle />}
    </>
  );
});

export default GroupItem;
