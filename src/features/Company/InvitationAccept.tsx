'use client';

import { Alert, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { useClientDataSWR } from '@/libs/swr';
import { companyService } from '@/services/company';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { refreshCompany } from './hooks';

const InvitationAccept = () => {
  const { t } = useTranslation('auth');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const openLogin = useUserStore((state) => state.openLogin);
  const [accepting, setAccepting] = useState(false);
  const {
    data: invitation,
    error,
    isLoading,
    mutate,
  } = useClientDataSWR(token ? ['company/invitation', token] : null, () =>
    companyService.getInvitation(token!),
  );

  if (error)
    return (
      <Alert
        action={<Button onClick={() => void mutate()}>{t('company.retry')}</Button>}
        type={'error'}
      />
    );
  if (isLoading) return <Text>{t('company.loading')}</Text>;
  if (!invitation) return null;

  const accept = async () => {
    try {
      setAccepting(true);
      await companyService.acceptInvitation(invitation.token);
      await refreshCompany();
      const company = await companyService.getMine();
      navigate(company ? `/${company.slug}` : '/');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Flexbox align={'center'} gap={16} padding={24} style={{ margin: 'auto', maxWidth: 480 }}>
      <Text fontSize={20} weight={600}>
        {t('company.invite.title')}
      </Text>
      <Text>{t('company.invite.description', { company: invitation.companyName })}</Text>
      <Text type={'secondary'}>
        {invitation.departmentName} · {invitation.position}
      </Text>
      {isLogin ? (
        <Button loading={accepting} type={'primary'} onClick={accept}>
          {t('company.invite.accept')}
        </Button>
      ) : (
        <Button type={'primary'} onClick={() => openLogin()}>
          {t('company.invite.signIn')}
        </Button>
      )}
    </Flexbox>
  );
};

export default InvitationAccept;
