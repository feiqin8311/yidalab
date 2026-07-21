import '../initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import DingTalkAccessGate from '@/components/DingTalkAccessGate';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { createAppRouter } from '@/utils/router';

import { startAppInitialization } from './initialize/bootstrap';
import { desktopRoutes } from './router/desktopRouter.config';

bootTiming.mark('bundle-eval');
startAppInitialization();

const debugProxyBase = '/_dangerous_local_dev_proxy';
const basename =
  window.__DEBUG_PROXY__ || window.location.pathname.startsWith(debugProxyBase)
    ? debugProxyBase
    : undefined;

const router = createAppRouter(desktopRoutes, { basename });

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
        页面加载失败。请关闭后从钉钉工作台重新打开，或用浏览器打开同一地址。
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
