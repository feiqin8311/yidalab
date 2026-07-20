'use client';

import { SendButton } from '@lobehub/editor/react';
import { Button, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SignatureIcon, Undo2Icon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

import LobeMessage from '../components/LobeMessage';

interface FullNameStepProps {
  onBack: () => void;
  onNext: () => void;
}

const FullNameStep = memo<FullNameStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('onboarding');
  const existingUsername = useUserStore((s) => s.user?.username || '');
  const updateUsername = useUserStore((s) => s.updateUsername);

  const [value, setValue] = useState(existingUsername);
  const [error, setError] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);

  const handleNext = useCallback(async () => {
    if (isNavigatingRef.current) return;

    const username = value.trim();
    if (!username) {
      setError(t('username.required'));
      return;
    }
    if (username.length > 64) {
      setError(t('username.tooLong'));
      return;
    }
    if (!/^\w+$/.test(username)) {
      setError(t('username.rule'));
      return;
    }

    isNavigatingRef.current = true;
    setIsNavigating(true);

    try {
      if (username !== existingUsername) await updateUsername(username);
      onNext();
    } catch {
      setError(t('username.updateFailed'));
      setIsNavigating(false);
      isNavigatingRef.current = false;
    }
  }, [existingUsername, onNext, t, updateUsername, value]);

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onBack();
  }, [onBack]);

  return (
    <Flexbox gap={16}>
      <LobeMessage sentences={[t('username.title'), t('username.title2'), t('username.title3')]} />
      <Flexbox horizontal align={'center'} gap={12}>
        <Input
          autoFocus
          placeholder={t('username.placeholder')}
          size="large"
          title={t('username.hint')}
          value={value}
          prefix={
            <Icon
              color={cssVar.colorTextDescription}
              icon={SignatureIcon}
              size={32}
              style={{
                marginInline: 8,
              }}
            />
          }
          styles={{
            input: {
              fontSize: 28,
              fontWeight: 'bolder',
            },
          }}
          suffix={
            <SendButton
              disabled={!value?.trim() || isNavigating}
              type="primary"
              style={{
                zoom: 1.5,
              }}
              onClick={handleNext}
            />
          }
          onPressEnter={handleNext}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
        />
      </Flexbox>
      {error && (
        <Text fontSize={12} type="danger">
          {error}
        </Text>
      )}
      <Flexbox horizontal justify={'flex-start'} style={{ marginTop: 32 }}>
        <Button
          disabled={isNavigating}
          icon={Undo2Icon}
          type={'text'}
          style={{
            color: cssVar.colorTextDescription,
          }}
          onClick={handleBack}
        >
          {t('back')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

FullNameStep.displayName = 'FullNameStep';

export default FullNameStep;
