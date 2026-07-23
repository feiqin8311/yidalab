'use client';

import { DEFAULT_HTML_DELIVERY_MODE, HTML_DELIVERY_MODES } from '@lobechat/const';
import type { HtmlDeliveryMode } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useStore } from '../store';
import { selectors } from '../store/selectors';

export interface HtmlDeliveryModeControlProps {
  disabled?: boolean;
  onChange?: (value: HtmlDeliveryMode) => void;
  /** When false, hide the title/desc (profile embeds its own labels). */
  showLabels?: boolean;
  style?: React.CSSProperties;
  value?: HtmlDeliveryMode;
}

export const resolveHtmlDeliveryModeValue = (value?: string | null): HtmlDeliveryMode =>
  HTML_DELIVERY_MODES.includes(value as HtmlDeliveryMode)
    ? (value as HtmlDeliveryMode)
    : DEFAULT_HTML_DELIVERY_MODE;

/** Presentational control — Select, same feel as model picker. */
export const HtmlDeliveryModeControl = memo<HtmlDeliveryModeControlProps>(
  ({ disabled, showLabels = true, style, value: valueProp, onChange }) => {
    const { t } = useTranslation('setting');
    const value = resolveHtmlDeliveryModeValue(valueProp);

    const options = useMemo(
      () =>
        [
          {
            label: t('settingOpening.htmlDeliveryMode.options.artifact'),
            value: 'artifact',
          },
          {
            label: t('settingOpening.htmlDeliveryMode.options.dingpan'),
            value: 'dingpan',
          },
          {
            label: t('settingOpening.htmlDeliveryMode.options.ask'),
            value: 'ask',
          },
        ] satisfies SelectProps['options'],
      [t],
    );

    const control = (
      <Select
        disabled={disabled}
        options={options}
        // base-ui Select trigger is width:100% of root — set root width via style (default compact).
        style={{ width: 240, ...style }}
        value={value}
        onChange={(next) => {
          if (disabled) return;
          onChange?.(next as HtmlDeliveryMode);
        }}
      />
    );

    if (!showLabels) return control;

    return (
      <Flexbox gap={8} width={'100%'}>
        <Text fontSize={14} weight={500}>
          {t('settingOpening.htmlDeliveryMode.title')}
        </Text>
        {control}
      </Flexbox>
    );
  },
);

HtmlDeliveryModeControl.displayName = 'HtmlDeliveryModeControl';

/** Bound to AgentSetting store (settings modal / Opening tab). */
const HtmlDeliveryModeFromStore = memo(() => {
  const [disabled, updateConfig] = useStore((s) => [s.disabled, s.setChatConfig]);
  const chatConfig = useStore(selectors.currentChatConfig);

  const handleChange = useCallback(
    (next: HtmlDeliveryMode) => {
      if (disabled) return;
      void updateConfig({ htmlDeliveryMode: next });
    },
    [disabled, updateConfig],
  );

  return (
    <HtmlDeliveryModeControl
      disabled={disabled}
      showLabels={false}
      value={chatConfig.htmlDeliveryMode}
      onChange={handleChange}
    />
  );
});

export default HtmlDeliveryModeFromStore;
