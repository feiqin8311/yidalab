import '../initialize';

import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import DingTalkAccessGate from '@/components/DingTalkAccessGate';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';

import { authRoutes } from './router/authRouter.config';

const router = createBrowserRouter(authRoutes);

// Free-login must run here: unauthenticated users are middleware-redirected to
// /signin (auth SPA), so the main-SPA gate alone never runs for DingTalk opens.
createRoot(document.getElementById('root')!).render(
  <BootErrorBoundary
    fallback={
      <div
        style={{
          alignItems: 'center',
          background: '#f7f9fb',
          color: '#374151',
          display: 'flex',
          fontSize: 14,
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 24,
          textAlign: 'center',
        }}
      >
        登录页加载失败，请关闭后从钉钉工作台重新打开。
      </div>
    }
  >
    <DingTalkAccessGate>
      <NextThemeProvider>
        <RouterProvider router={router} />
      </NextThemeProvider>
    </DingTalkAccessGate>
  </BootErrorBoundary>,
);
