import { Form } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { BusinessSignupFomData } from '@/business/client/hooks/useBusinessSignup';
import { useBusinessSignup } from '@/business/client/hooks/useBusinessSignup';
import { message } from '@/components/AntdStaticMethods';
import type { AuthFetchOptions } from '@/features/Auth/utils/authFetchOptions';
import { withCaptchaToken } from '@/features/Auth/utils/authFetchOptions';
import { useAuthServerConfigStore } from '@/features/AuthShell';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { signUp } from '@/libs/better-auth/auth-client';
import { buildOnboardingRedirectUrl } from '@/utils/onboardingRedirect';

import type { BaseSignUpFormValues } from './types';

export type SignUpFormValues = BaseSignUpFormValues & BusinessSignupFomData;

interface SignUpErrorLike {
  code?: string;
  details?: {
    cause?: {
      code?: string;
      constraint?: string;
    };
  };
  message?: string;
}

const isUniqueViolation = (error: SignUpErrorLike) =>
  error.code === 'FAILED_TO_CREATE_USER' && error.details?.cause?.code === '23505';

const isUsernameDuplicate = (error: SignUpErrorLike) =>
  isUniqueViolation(error) &&
  (error.details?.cause?.constraint === 'users_username_unique' ||
    JSON.stringify(error).toLowerCase().includes('username'));

export const useSignUp = () => {
  const { t } = useTranslation(['auth', 'authError']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<SignUpFormValues>();
  const [loading, setLoading] = useState(false);
  const { getCaptchaTokenOnError, getFetchOptions, preSocialSignupCheck, businessElement } =
    useBusinessSignup(form);
  const enableEmailVerification = useAuthServerConfigStore(
    (s) => s.serverConfig.enableEmailVerification || false,
  );
  const enableBusinessFeatures = useAuthServerConfigStore(
    (s) => s.serverConfig.enableBusinessFeatures || false,
  );

  const handleSignUp = async (values: SignUpFormValues) => {
    setLoading(true);
    await trackLoginOrSignupClicked({ spm: 'signup.submit.click' });

    try {
      if (enableBusinessFeatures && !(await preSocialSignupCheck(values))) {
        setLoading(false);
        return;
      }

      const callbackUrl = searchParams.get('callbackUrl') || '/';
      // New users always go through onboarding first; the original target is
      // threaded via the `callbackUrl` query param and restored on finish.
      const redirectUrl = buildOnboardingRedirectUrl(callbackUrl);
      const email = values.email.trim().toLowerCase();
      const username = values.username.trim();
      const fetchOptions = await getFetchOptions();

      const submit = async (nextFetchOptions?: AuthFetchOptions) =>
        signUp.email({
          callbackURL: redirectUrl,
          email,
          fetchOptions: nextFetchOptions,
          name: username,
          password: values.password,
          username,
        });

      let { error } = await submit(fetchOptions);

      if (error) {
        const captchaToken = await getCaptchaTokenOnError(error);
        if (captchaToken === null) return;
        if (captchaToken) {
          ({ error } = await submit(withCaptchaToken(fetchOptions, captchaToken)));
        }
      }

      if (error) {
        const signUpError = error as SignUpErrorLike;
        const isEmailDuplicate =
          isUniqueViolation(signUpError) && !isUsernameDuplicate(signUpError);

        if (isUsernameDuplicate(signUpError)) {
          message.error(t('betterAuth.errors.usernameExists'));
          return;
        }

        if (isEmailDuplicate) {
          message.error(t('betterAuth.errors.emailExists'));
          return;
        }

        if (signUpError.code === 'INVALID_EMAIL' || signUpError.message === 'Invalid email') {
          message.error(t('betterAuth.errors.emailInvalid'));
          return;
        }

        const translated = signUpError.code
          ? t(`authError:codes.${signUpError.code}`, { defaultValue: '' })
          : '';
        message.error(translated || signUpError.message || t('betterAuth.signup.error'));
        return;
      }

      if (enableEmailVerification) {
        navigate(
          `/verify-email?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(redirectUrl)}`,
        );
      } else {
        // onboarding lives in the main app, outside this auth SPA — full page load required
        window.location.href = redirectUrl;
      }
    } catch {
      message.error(t('betterAuth.signup.error'));
    } finally {
      setLoading(false);
    }
  };

  return { businessElement, form, loading, onSubmit: handleSignUp };
};
