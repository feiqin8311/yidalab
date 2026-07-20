'use client';

import { isDesktop } from '@lobechat/const';
import { useAnalytics } from '@lobehub/analytics/react';
import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { FlaskConical, MessageCircle, SettingsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import HighlightNotification from '@/components/HighlightNotification';
import { GITHUB } from '@/const/url';
import Billboard from '@/features/Billboard';
import { useActiveNavKey } from '@/features/NavPanel';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';

import { resolveFooterPromotionState } from './promotionPipeline';

const AGENT_ONBOARDING_PROMO_SLUG = 'agent-onboarding-promo-v1';

const PRODUCT_HUNT_NOTIFICATION = {
  actionHref: 'https://www.producthunt.com/products/lobehub?launch=lobehub',
  endTime: new Date('2026-02-01T00:00:00Z'),
  image: 'https://hub-apac-1.lobeobjects.space/og/lobehub-ph.png',
  slug: 'product-hunt-2026',
  startTime: new Date('2026-01-27T08:00:00Z'),
} as const;

interface PromotionCard {
  actionHref?: string;
  actionIcon?: ReactNode;
  actionLabel: string;
  description: string;
  image?: string;
  onAction?: () => void;
  onActionClick?: () => void;
  onClose: () => void;
  title: string;
}

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { analytics } = useAnalytics();
  const { footer } = useNavLayout();
  const activeNavKey = useActiveNavKey();
  const isHomeSidebar = activeNavKey === 'home';
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const isMobile = useServerConfigStore((s) => !!s.isMobile);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const [agentOnboardingFinished, agentOnboardingStarted, classicOnboardingFinished, isDevMode] =
    useUserStore((s) => [
      !!s.agentOnboarding?.finishedAt,
      !!s.agentOnboarding?.activeTopicId,
      !!s.onboarding?.finishedAt,
      userGeneralSettingsSelectors.config(s).isDevMode,
    ]);
  const [isAgentOnboardingCardOpen, setIsAgentOnboardingCardOpen] = useState(false);
  const [isProductHuntCardOpen, setIsProductHuntCardOpen] = useState(false);

  const [isAgentOnboardingPromoRead, isProductHuntNotificationRead, updateSystemStatus] =
    useGlobalStore((s) => [
      systemStatusSelectors.isNotificationRead(AGENT_ONBOARDING_PROMO_SLUG)(s),
      systemStatusSelectors.isNotificationRead(PRODUCT_HUNT_NOTIFICATION.slug)(s),
      s.updateSystemStatus,
    ]);

  const isWithinTimeWindow = useMemo(() => {
    const now = new Date();
    return now >= PRODUCT_HUNT_NOTIFICATION.startTime && now <= PRODUCT_HUNT_NOTIFICATION.endTime;
  }, []);

  const { shouldAutoShowAgentOnboardingPromo, shouldAutoShowProductHuntCard } = useMemo(
    () =>
      resolveFooterPromotionState({
        agentOnboardingFinished,
        agentOnboardingStarted,
        classicOnboardingFinished,
        enableAgentOnboarding: !!enableAgentOnboarding,
        isAgentOnboardingPromoRead,
        isDesktop,
        isMobile,
        isProductHuntNotificationRead,
        isWithinProductHuntWindow: isWithinTimeWindow,
        serverConfigInit,
      }),
    [
      agentOnboardingFinished,
      agentOnboardingStarted,
      classicOnboardingFinished,
      enableAgentOnboarding,
      isAgentOnboardingPromoRead,
      isMobile,
      isProductHuntNotificationRead,
      isWithinTimeWindow,
      serverConfigInit,
    ],
  );

  const trackPromotionEvent = useCallback(
    (eventName: string, properties: Record<string, string>) => {
      try {
        analytics?.track({ name: eventName, properties });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics],
  );

  const markNotificationRead = useCallback(
    (slug: string) => {
      const currentSlugs = useGlobalStore.getState().status.readNotificationSlugs || [];

      if (currentSlugs.includes(slug)) return;

      updateSystemStatus({ readNotificationSlugs: [...currentSlugs, slug] });
    },
    [updateSystemStatus],
  );

  useEffect(() => {
    if (!shouldAutoShowAgentOnboardingPromo) return;

    setIsAgentOnboardingCardOpen(true);
    trackPromotionEvent('agent_onboarding_promo_viewed', {
      spm: 'homepage.agent_onboarding_promo.viewed',
      trigger: 'auto',
    });
  }, [shouldAutoShowAgentOnboardingPromo, trackPromotionEvent]);

  useEffect(() => {
    if (!shouldAutoShowProductHuntCard) return;

    setIsProductHuntCardOpen(true);
    trackPromotionEvent('product_hunt_card_viewed', {
      spm: 'homepage.product_hunt.viewed',
      trigger: 'auto',
    });
  }, [isWithinTimeWindow, shouldAutoShowProductHuntCard, trackPromotionEvent]);

  const handleCloseAgentOnboardingCard = useCallback(() => {
    setIsAgentOnboardingCardOpen(false);
    markNotificationRead(AGENT_ONBOARDING_PROMO_SLUG);
    trackPromotionEvent('agent_onboarding_promo_closed', {
      spm: 'homepage.agent_onboarding_promo.closed',
    });
  }, [markNotificationRead, trackPromotionEvent]);

  const handleAgentOnboardingAction = useCallback(() => {
    setIsAgentOnboardingCardOpen(false);
    markNotificationRead(AGENT_ONBOARDING_PROMO_SLUG);
    trackPromotionEvent('agent_onboarding_promo_clicked', {
      spm: 'homepage.agent_onboarding_promo.clicked',
    });
    navigate('/onboarding/agent');
  }, [markNotificationRead, navigate, trackPromotionEvent]);

  const handleCloseProductHuntCard = useCallback(() => {
    setIsProductHuntCardOpen(false);
    markNotificationRead(PRODUCT_HUNT_NOTIFICATION.slug);
    trackPromotionEvent('product_hunt_card_closed', {
      spm: 'homepage.product_hunt.closed',
    });
  }, [markNotificationRead, trackPromotionEvent]);

  const handleProductHuntActionClick = useCallback(() => {
    trackPromotionEvent('product_hunt_action_clicked', {
      spm: 'homepage.product_hunt.action_clicked',
    });
  }, [trackPromotionEvent]);

  const activePromotion = useMemo<PromotionCard | undefined>(() => {
    if (isAgentOnboardingCardOpen) {
      return {
        actionIcon: <Icon icon={MessageCircle} size={14} />,
        actionLabel: t('agentOnboardingPromo.actionLabel'),
        description: t('agentOnboardingPromo.description'),
        onAction: handleAgentOnboardingAction,
        onClose: handleCloseAgentOnboardingCard,
        title: t('agentOnboardingPromo.title'),
      };
    }

    if (isProductHuntCardOpen) {
      return {
        actionHref: PRODUCT_HUNT_NOTIFICATION.actionHref,
        actionLabel: t('productHunt.actionLabel'),
        description: t('productHunt.description'),
        image: PRODUCT_HUNT_NOTIFICATION.image,
        onActionClick: handleProductHuntActionClick,
        onClose: handleCloseProductHuntCard,
        title: t('productHunt.title'),
      };
    }

    return undefined;
  }, [
    handleAgentOnboardingAction,
    handleCloseAgentOnboardingCard,
    handleCloseProductHuntCard,
    handleProductHuntActionClick,
    isAgentOnboardingCardOpen,
    isProductHuntCardOpen,
    t,
  ]);

  return (
    <>
      {footer.layout === 'expanded' ? (
        <Flexbox horizontal align={'center'} gap={2} justify={'space-between'} padding={8}>
          <Flexbox horizontal align={'center'} flex={1} gap={2}>
            {!footer.hideGitHub && (
              <a aria-label={'GitHub'} href={GITHUB} rel="noopener noreferrer" target={'_blank'}>
                <ActionIcon icon={GithubIcon} size={16} title={'GitHub'} />
              </a>
            )}
            <WorkspaceLink to="/eval">
              <ActionIcon icon={FlaskConical} size={16} title="Evaluation Lab" />
            </WorkspaceLink>
          </Flexbox>
          <ThemeButton placement={'topCenter'} size={16} />
        </Flexbox>
      ) : (
        <Flexbox horizontal align={'center'} gap={2} padding={8}>
          {isDevMode && (
            <WorkspaceLink escape to="/settings">
              <ActionIcon
                aria-label={t('userPanel.setting')}
                icon={SettingsIcon}
                size={16}
                title={t('userPanel.setting')}
              />
            </WorkspaceLink>
          )}
        </Flexbox>
      )}
      {activePromotion && (
        <HighlightNotification
          open
          actionHref={activePromotion.actionHref}
          actionIcon={activePromotion.actionIcon}
          actionLabel={activePromotion.actionLabel}
          description={activePromotion.description}
          image={activePromotion.image}
          title={activePromotion.title}
          onAction={activePromotion.onAction}
          onActionClick={activePromotion.onActionClick}
          onClose={activePromotion.onClose}
        />
      )}
      {isHomeSidebar && <Billboard />}
    </>
  );
});

export default Footer;
