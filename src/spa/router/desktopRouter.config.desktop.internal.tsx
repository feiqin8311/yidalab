'use client';

/**
 * YidaLab internal desktop routes.
 * Stripped paths: community, image, video, eval, fleet, billing.
 * Kept: devices (lambda device router required for chat device switcher).
 */

import {
  BrainCircuit,
  FilePenIcon,
  Home,
  LayoutGridIcon,
  LibraryBigIcon,
  MessageSquarePlus,
  Settings,
} from 'lucide-react';
import type { RouteObject } from 'react-router';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import { workspaceHomeRouteMeta } from '@/features/Workspace/routeMeta';
import DesktopOnboarding from '@/routes/(desktop)/desktop-onboarding';
// Layouts — sync import (Electron local, no network overhead)
import DesktopMainLayout from '@/routes/(main)/_layout';
import TaskWorkspaceLayout from '@/routes/(main)/(task-workspace)/_layout';
import WorkspaceSlugLayout from '@/routes/(main)/[workspaceSlug]/_layout';
import WorkspaceSlugSettingsIndexPage from '@/routes/(main)/[workspaceSlug]/settings';
import WorkspaceSlugSettingsContentLayout from '@/routes/(main)/[workspaceSlug]/settings/_content-layout';
import WorkspaceSlugSettingsLayout from '@/routes/(main)/[workspaceSlug]/settings/_layout';
import WorkspaceSlugSettingsAdvancedPage from '@/routes/(main)/[workspaceSlug]/settings/advanced';
import WorkspaceSlugSettingsApiKeyPage from '@/routes/(main)/[workspaceSlug]/settings/apikey';
import WorkspaceSlugSettingsAppearancePage from '@/routes/(main)/[workspaceSlug]/settings/appearance';
import WorkspaceSlugSettingsAuditLogPage from '@/routes/(main)/[workspaceSlug]/settings/audit-log';
import WorkspaceSlugSettingsConnectorPage from '@/routes/(main)/[workspaceSlug]/settings/connector';
import WorkspaceSlugSettingsCreditsPage from '@/routes/(main)/[workspaceSlug]/settings/credits';
import WorkspaceSlugSettingsCredsPage from '@/routes/(main)/[workspaceSlug]/settings/creds';
import WorkspaceSlugSettingsDepartmentsPage from '@/routes/(main)/[workspaceSlug]/settings/departments';
import WorkspaceSlugSettingsDevicesPage from '@/routes/(main)/[workspaceSlug]/settings/devices';
import WorkspaceSlugSettingsGeneralPage from '@/routes/(main)/[workspaceSlug]/settings/general';
import WorkspaceSlugSettingsHotkeyPage from '@/routes/(main)/[workspaceSlug]/settings/hotkey';
import WorkspaceSlugSettingsMembersPage from '@/routes/(main)/[workspaceSlug]/settings/members';
import WorkspaceSlugSettingsMemoryPage from '@/routes/(main)/[workspaceSlug]/settings/memory';
import WorkspaceSlugSettingsNotificationPage from '@/routes/(main)/[workspaceSlug]/settings/notification';
import WorkspaceSlugSettingsPlansPage from '@/routes/(main)/[workspaceSlug]/settings/plans';
import WorkspaceSlugSettingsProfilePage from '@/routes/(main)/[workspaceSlug]/settings/profile';
import WorkspaceSlugSettingsProviderPage from '@/routes/(main)/[workspaceSlug]/settings/provider';
import WorkspaceSlugSettingsProxyPage from '@/routes/(main)/[workspaceSlug]/settings/proxy';
import WorkspaceSlugSettingsRecommendedExamplesPage from '@/routes/(main)/[workspaceSlug]/settings/recommended-examples';
import WorkspaceSlugSettingsReferralPage from '@/routes/(main)/[workspaceSlug]/settings/referral';
import WorkspaceSlugSettingsServiceModelPage from '@/routes/(main)/[workspaceSlug]/settings/service-model';
import WorkspaceSlugSettingsSkillPage from '@/routes/(main)/[workspaceSlug]/settings/skill';
import WorkspaceSlugSettingsStatsPage from '@/routes/(main)/[workspaceSlug]/settings/stats';
import WorkspaceSlugSettingsStoragePage from '@/routes/(main)/[workspaceSlug]/settings/storage';
import WorkspaceSlugSettingsSystemToolsPage from '@/routes/(main)/[workspaceSlug]/settings/system-tools';
import WorkspaceSlugSettingsUsagePage from '@/routes/(main)/[workspaceSlug]/settings/usage';
// Pages — sync import
import AgentPage from '@/routes/(main)/agent';
import DesktopChatLayout from '@/routes/(main)/agent/_layout';
import DesktopAgentChatLayout from '@/routes/(main)/agent/(chat)/_layout';
import AgentChannelPage from '@/routes/(main)/agent/channel';
import AgentDocumentsIndexRoute from '@/routes/(main)/agent/docs';
import AgentDocumentLayout from '@/routes/(main)/agent/docs/_layout';
import AgentDocumentRoute from '@/routes/(main)/agent/docs/[docId]';
import { agentRouteMeta, topicsRouteMeta } from '@/routes/(main)/agent/features/routeMeta';
import AgentProfilePage from '@/routes/(main)/agent/profile';
import AgentStatsPage from '@/routes/(main)/agent/stats';
import AgentTaskDetailRoute from '@/routes/(main)/agent/task/[taskId]';
import AgentScopedTasksRoute from '@/routes/(main)/agent/tasks';
import AgentTopicsPage from '@/routes/(main)/agent/topics';
import CompanyInvitationPage from '@/routes/(main)/company/invite/[token]';
import DevtoolsIndexPage from '@/routes/(main)/devtools';
import DevtoolsLayout from '@/routes/(main)/devtools/_layout';
import DevtoolsToolPage from '@/routes/(main)/devtools/[identifier]';
import FeedbackPage from '@/routes/(main)/feedback';
import FunctionsPage from '@/routes/(main)/functions';
import OperationsFunctionPage from '@/routes/(main)/functions/[functionId]';
import OperationsFunctionRunPage from '@/routes/(main)/functions/[functionId]/[runId]';
import AmazonOldProductKeywordPage from '@/routes/(main)/functions/amazon-old-product-keyword-analysis';
import AmazonOldProductKeywordRunPage from '@/routes/(main)/functions/amazon-old-product-keyword-analysis/[runId]';
import LingxingAdsPage from '@/routes/(main)/functions/lingxing-ads';
import GroupPage from '@/routes/(main)/group';
import DesktopGroupLayout from '@/routes/(main)/group/_layout';
import { groupRouteMeta } from '@/routes/(main)/group/features/routeMeta';
import GroupProfilePage from '@/routes/(main)/group/profile';
import DesktopMemoryLayout from '@/routes/(main)/memory/_layout';
import MemoryHomePage from '@/routes/(main)/memory/(home)';
import MemoryActivitiesPage from '@/routes/(main)/memory/activities';
import MemoryContextsPage from '@/routes/(main)/memory/contexts';
import MemoryExperiencesPage from '@/routes/(main)/memory/experiences';
import MemoryIdentitiesPage from '@/routes/(main)/memory/identities';
import MemoryPreferencesPage from '@/routes/(main)/memory/preferences';
import PageIndexPage from '@/routes/(main)/page';
import DesktopPageLayout from '@/routes/(main)/page/_layout';
import PageDetailPage from '@/routes/(main)/page/[id]';
import ResourceLayout from '@/routes/(main)/resource/_layout';
import ResourceHomePage from '@/routes/(main)/resource/(home)';
import ResourceHomeLayout from '@/routes/(main)/resource/(home)/_layout';
import ResourceLibraryPage from '@/routes/(main)/resource/library';
import ResourceLibraryLayout from '@/routes/(main)/resource/library/_layout';
import ResourceLibrarySlugPage from '@/routes/(main)/resource/library/[slug]';
import SettingsTabPage from '@/routes/(main)/settings';
import SettingsLayout from '@/routes/(main)/settings/_layout';
import { settingsRouteMeta } from '@/routes/(main)/settings/features/routeMeta';
import { ProviderDetailPage, ProviderLayout } from '@/routes/(main)/settings/provider';
import TaskDetailRoute from '@/routes/(main)/task/[taskId]';
import AllTasksPage from '@/routes/(main)/tasks';
import SharePagePage from '@/routes/share/page/[id]';
import ShareTopicPage from '@/routes/share/t/[id]';
import ShareTopicLayout from '@/routes/share/t/[id]/_layout';
import { shareTopicRouteMeta } from '@/routes/share/t/[id]/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';
import { ErrorBoundary, redirectElement } from '@/utils/router';

/**
 * Children shared between `/` and `/:workspaceSlug` for the Electron build.
 * Mirror of the async `sharedMainAreaChildren` — paths must match (the router
 * sync test enforces this).
 */
export const sharedMainAreaChildren: RouteObject[] = [
  // Chat routes (agent)
  {
    children: [
      {
        element: redirectElement('..'),
        index: true,
      },
      {
        children: [
          {
            children: [
              {
                element: <AgentPage />,
                handle: { meta: agentRouteMeta },
                index: true,
              },
              {
                element: <AgentPage />,
                handle: { meta: agentRouteMeta },
                path: ':topicId',
              },
            ],
            element: <DesktopAgentChatLayout />,
          },
          {
            children: [
              {
                element: <AgentDocumentsIndexRoute />,
                index: true,
              },
              {
                element: <AgentDocumentRoute />,
                handle: { meta: agentDocumentRouteMeta },
                path: ':docId',
              },
            ],
            element: <AgentDocumentLayout />,
            path: 'docs',
          },
          {
            element: <AgentProfilePage />,
            path: 'profile',
          },
          {
            element: <AgentChannelPage />,
            path: 'channel',
          },
          {
            element: <AgentTopicsPage />,
            handle: { meta: topicsRouteMeta },
            path: 'topics',
          },
          {
            element: <AgentStatsPage />,
            path: 'stats',
          },
          {
            element: <AgentScopedTasksRoute />,
            handle: { meta: tasksRouteMeta },
            path: 'tasks',
          },
          {
            element: <AgentTaskDetailRoute />,
            handle: { meta: taskRouteMeta },
            path: 'task/:taskId',
          },
        ],
        element: <DesktopChatLayout />,
        errorElement: <ErrorBoundary />,
        path: ':aid',
      },
    ],
    path: 'agent',
  },

  // Fleet view (side-by-side agent dashboard)
  // Group chat routes
  {
    children: [
      {
        element: redirectElement('..'),
        index: true,
      },
      {
        children: [
          {
            element: <GroupPage />,
            handle: { meta: groupRouteMeta },
            index: true,
          },
          {
            element: <GroupProfilePage />,
            path: 'profile',
          },
          {
            element: <GroupPage />,
            handle: { meta: groupRouteMeta },
            path: ':topicId',
          },
        ],
        element: <DesktopGroupLayout />,
        errorElement: <ErrorBoundary />,
        path: ':gid',
      },
    ],
    path: 'group',
  },

  // Discover routes with nested structure
  // Resource routes
  {
    children: [
      // Home routes (resource list)
      {
        children: [
          {
            element: <ResourceHomePage />,
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.resources' }),
            },
            index: true,
          },
        ],
        element: <ResourceHomeLayout />,
      },
      // Library routes (knowledge base detail)
      {
        children: [
          {
            element: <ResourceLibraryPage />,
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            index: true,
          },
          {
            element: <ResourceLibrarySlugPage />,
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            path: ':slug',
          },
        ],
        element: <ResourceLibraryLayout />,
        path: 'library/:id',
      },
    ],
    element: <ResourceLayout />,
    errorElement: <ErrorBoundary />,
    path: 'resource',
  },

  // Memory routes
  {
    children: [
      {
        element: <MemoryHomePage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        index: true,
      },
      {
        element: <MemoryIdentitiesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryIdentities' }),
        },
        path: 'identities',
      },
      {
        element: <MemoryContextsPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryContexts' }),
        },
        path: 'contexts',
      },
      {
        element: <MemoryPreferencesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryPreferences' }),
        },
        path: 'preferences',
      },
      {
        element: <MemoryExperiencesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryExperiences' }),
        },
        path: 'experiences',
      },
      {
        element: <MemoryActivitiesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        path: 'activities',
      },
    ],
    element: <DesktopMemoryLayout />,
    errorElement: <ErrorBoundary />,
    path: 'memory',
  },

  // Company feedback
  {
    children: [
      {
        element: <FeedbackPage />,
        handle: {
          meta: routeMeta({ icon: MessageSquarePlus, titleKey: 'navigation.feedback' }),
        },
        index: true,
      },
    ],
    errorElement: <ErrorBoundary />,
    path: 'feedback',
  },

  // Business functions center
  {
    children: [
      {
        element: <FunctionsPage />,
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.functions' }),
        },
        index: true,
      },
      {
        element: <LingxingAdsPage />,
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.lingxingAds' }),
        },
        path: 'lingxing-ads',
      },
      {
        element: <AmazonOldProductKeywordPage />,
        handle: {
          meta: routeMeta({
            icon: LayoutGridIcon,
            titleKey: 'navigation.amazonOldProductKeyword',
          }),
        },
        path: 'amazon-old-product-keyword-analysis',
      },
      {
        element: <AmazonOldProductKeywordRunPage />,
        handle: {
          meta: routeMeta({
            icon: LayoutGridIcon,
            titleKey: 'navigation.amazonOldProductKeyword',
          }),
        },
        path: 'amazon-old-product-keyword-analysis/:runId',
      },
      {
        element: <OperationsFunctionPage />,
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.functions' }),
        },
        path: ':functionId',
      },
      {
        element: <OperationsFunctionRunPage />,
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.functions' }),
        },
        path: ':functionId/:runId',
      },
    ],
    errorElement: <ErrorBoundary />,
    path: 'functions',
  },

  // Video routes
  // Image routes
  ...BusinessDesktopRoutesWithMainLayout,

  // Eval routes
  // Task workspace routes (cross-agent)
  {
    children: [
      {
        children: [
          {
            element: <AllTasksPage />,
            handle: { meta: tasksRouteMeta },
            index: true,
          },
        ],
        errorElement: <ErrorBoundary resetPath=".." />,
        path: 'tasks',
      },
      {
        children: [
          {
            element: <TaskDetailRoute />,
            handle: { meta: taskRouteMeta },
            path: ':taskId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'task',
      },
    ],
    element: <TaskWorkspaceLayout />,
  },

  // Pages routes
  {
    children: [
      {
        element: <PageIndexPage />,
        handle: {
          meta: routeMeta({ icon: FilePenIcon, titleKey: 'navigation.pages' }),
        },
        index: true,
      },
      {
        element: <PageDetailPage />,
        handle: { meta: pageRouteMeta },
        path: ':id',
      },
    ],
    element: <DesktopPageLayout />,
    errorElement: <ErrorBoundary />,
    path: 'page',
  },
];

// Desktop router configuration — all sync imports for Electron local build
export const desktopRoutes: RouteObject[] = [
  {
    children: [
      ...sharedMainAreaChildren,

      // Settings routes (personal-only — never mirrored under /:workspaceSlug)
      {
        children: [
          {
            element: redirectElement('/settings/profile'),
            index: true,
          },
          // Provider routes with nested structure
          {
            children: [
              {
                element: redirectElement('/settings/provider/all'),
                index: true,
              },
              {
                element: <ProviderDetailPage />,
                handle: {
                  meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
                },
                path: ':providerId',
              },
            ],
            element: <ProviderLayout />,
            handle: {
              meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
            },
            path: 'provider',
          },
          {
            element: <SettingsTabPage />,
            handle: { settingsTab: SettingsTabs.Memory },
            path: 'memory',
          },
          {
            element: redirectElement('/agent/channel'),
            path: 'messenger',
          },
          {
            element: redirectElement('/agent/channel'),
            path: 'messenger/:sub',
          },
          // Other settings tabs
          {
            element: <SettingsTabPage />,
            handle: { meta: settingsRouteMeta },
            path: ':tab',
          },
          // Tabs that need a sub-segment reuse the same tab page; nested feature
          // components read `:sub` via useParams.
          {
            element: <SettingsTabPage />,
            handle: { meta: settingsRouteMeta },
            path: ':tab/:sub',
          },
        ],
        element: <SettingsLayout />,
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },
      {
        element: <CompanyInvitationPage />,
        path: 'company/invite/:token',
      },

      // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
      // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
      {
        children: [
          // Workspace home — handled by the persistent `DesktopHomeLayout`
          // (mirrors `/` index). Adding an element renders Home twice.
          { handle: { meta: workspaceHomeRouteMeta }, index: true },
          ...sharedMainAreaChildren,
          // Workspace settings — `/:slug/settings/*`. Dedicated layout with
          // its own sidebar (workspace avatar + 6 tabs + back-to-chat), fully
          // decoupled from personal `/settings/*`.
          {
            children: [
              { element: <WorkspaceSlugSettingsIndexPage />, index: true },
              // Full-bleed tabs render directly inside the workspace settings
              // shell (sidebar + outlet) — they own their internal layout.
              { element: <WorkspaceSlugSettingsProviderPage />, path: 'provider' },
              { element: <WorkspaceSlugSettingsSkillPage />, path: 'skill' },
              { element: <WorkspaceSlugSettingsConnectorPage />, path: 'connector' },
              // Padded tabs share a centered, max-width container layout.
              {
                children: [
                  { element: <WorkspaceSlugSettingsGeneralPage />, path: 'general' },
                  { element: <WorkspaceSlugSettingsDepartmentsPage />, path: 'departments' },
                  { element: <WorkspaceSlugSettingsMembersPage />, path: 'members' },
                  { element: <WorkspaceSlugSettingsStatsPage />, path: 'stats' },
                  { element: <WorkspaceSlugSettingsPlansPage />, path: 'plans' },
                  { element: <WorkspaceSlugSettingsCreditsPage />, path: 'credits' },
                  { element: <WorkspaceSlugSettingsUsagePage />, path: 'usage' },
                  { element: <WorkspaceSlugSettingsServiceModelPage />, path: 'service-model' },
                  { element: <WorkspaceSlugSettingsCredsPage />, path: 'creds' },
                  { element: <WorkspaceSlugSettingsApiKeyPage />, path: 'apikey' },
                  { element: <WorkspaceSlugSettingsAuditLogPage />, path: 'audit-log' },
                  { element: <WorkspaceSlugSettingsStoragePage />, path: 'storage' },
                  { element: <WorkspaceSlugSettingsDevicesPage />, path: 'devices' },
                  { element: <WorkspaceSlugSettingsProfilePage />, path: 'profile' },
                  { element: <WorkspaceSlugSettingsAppearancePage />, path: 'appearance' },
                  { element: <WorkspaceSlugSettingsHotkeyPage />, path: 'hotkey' },
                  { element: <WorkspaceSlugSettingsNotificationPage />, path: 'notification' },
                  { element: <WorkspaceSlugSettingsMemoryPage />, path: 'memory' },
                  {
                    element: <WorkspaceSlugSettingsRecommendedExamplesPage />,
                    path: 'recommended-examples',
                  },
                  { element: <WorkspaceSlugSettingsReferralPage />, path: 'referral' },
                  { element: <WorkspaceSlugSettingsProxyPage />, path: 'proxy' },
                  { element: <WorkspaceSlugSettingsSystemToolsPage />, path: 'system-tools' },
                  { element: <WorkspaceSlugSettingsAdvancedPage />, path: 'advanced' },
                ],
                element: <WorkspaceSlugSettingsContentLayout />,
              },
            ],
            element: <WorkspaceSlugSettingsLayout />,
            errorElement: <ErrorBoundary />,
            path: 'settings',
          },
          // Legacy `/:slug/billing/*` URLs — redirect to `/:slug/settings/*`.
        ],
        element: <WorkspaceSlugLayout />,
        errorElement: <ErrorBoundary />,
        path: ':workspaceSlug',
      },

      // Default route - home page (handled by persistent layout)
      {
        handle: {
          meta: routeMeta({ icon: Home, titleKey: 'navigation.home' }),
        },
        index: true,
      },
      // Catch-all route
      {
        element: redirectElement('/'),
        path: '*',
      },
    ],
    element: <DesktopMainLayout />,
    errorElement: <ErrorBoundary />,
    path: '/',
  },

  ...BusinessDesktopRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: <ShareTopicPage />,
        handle: { meta: shareTopicRouteMeta },
        path: ':id',
      },
    ],
    element: <ShareTopicLayout />,
    path: '/share/t',
  },

  // Share page route (outside main layout)
  {
    children: [
      {
        element: <SharePagePage />,
        path: ':id',
      },
    ],
    path: '/share/page',
  },

  // Devtools route (outside main layout, dev-only)
  ...(__DEV__
    ? [
        {
          children: [
            { element: <DevtoolsIndexPage />, index: true },
            { element: <DevtoolsToolPage />, path: ':identifier' },
          ],
          element: <DevtoolsLayout />,
          errorElement: <ErrorBoundary />,
          path: '/devtools',
        },
      ]
    : []),
];

// Desktop owns its onboarding flow. Web-only onboarding routes are intentionally
// absent from Electron so personal onboarding redirects fail visibly instead of
// looping back into desktop login.
desktopRoutes.push({
  element: <DesktopOnboarding />,
  errorElement: <ErrorBoundary />,
  path: '/desktop-onboarding',
});
