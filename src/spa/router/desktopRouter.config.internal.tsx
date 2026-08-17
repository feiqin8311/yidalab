'use client';

/**
 * YidaLab internal desktop routes.
 * Stripped paths: image, video, eval, fleet, billing.
 * Kept: community (company skill / MCP market) and devices.
 */

import {
  BrainCircuit,
  FilePenIcon,
  Home,
  LayoutGridIcon,
  LibraryBigIcon,
  MessageSquarePlus,
  Settings,
  ShapesIcon,
} from 'lucide-react';
import { type RouteObject } from 'react-router';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import { verifyReportsRouteMeta, verifyRouteMeta } from '@/features/Verify/routeMeta';
import { workspaceHomeRouteMeta } from '@/features/Workspace/routeMeta';
import { agentRouteMeta, topicsRouteMeta } from '@/routes/(main)/agent/features/routeMeta';
import { groupRouteMeta } from '@/routes/(main)/group/features/routeMeta';
import { settingsRouteMeta } from '@/routes/(main)/settings/features/routeMeta';
import { shareTopicRouteMeta } from '@/routes/share/t/[id]/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

const agentChatElement = dynamicElement(() => import('@/routes/(main)/agent'), 'Desktop > Chat');

const groupChatElement = dynamicElement(
  () => import('@/routes/(main)/group'),
  'Desktop > Agent Group',
);

/**
 * Children shared between the root tree (`/`) and the workspace tree
 * (`/:workspaceSlug`). Personal-only segments (settings, index, catch-all,
 * the workspace-slug block itself) are NOT included.
 *
 * Index redirects inside this list use **relative paths** so they resolve
 * correctly under both `/` (→ `/`) and `/:workspaceSlug` (→ `/:workspaceSlug`).
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
                element: agentChatElement,
                handle: { meta: agentRouteMeta },
                index: true,
              },
              {
                element: agentChatElement,
                handle: { meta: agentRouteMeta },
                path: ':topicId',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/agent/(chat)/_layout'),
              'Desktop > Chat > ChatLayout',
            ),
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/docs'),
                  'Desktop > Chat > DocumentsIndex',
                ),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/docs/[docId]'),
                  'Desktop > Chat > Document',
                ),
                handle: { meta: agentDocumentRouteMeta },
                path: ':docId',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/agent/docs/_layout'),
              'Desktop > Chat > DocumentLayout',
            ),
            path: 'docs',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/profile'),
              'Desktop > Chat > Profile',
            ),
            path: 'profile',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/channel'),
              'Desktop > Chat > Channel',
            ),
            path: 'channel',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/topics'),
              'Desktop > Chat > Topics',
            ),
            handle: { meta: topicsRouteMeta },
            path: 'topics',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/stats'),
              'Desktop > Chat > Stats',
            ),
            path: 'stats',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/tasks'),
              'Desktop > Chat > Tasks',
            ),
            handle: { meta: tasksRouteMeta },
            path: 'tasks',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/task/[taskId]'),
              'Desktop > Chat > Task Detail',
            ),
            handle: { meta: taskRouteMeta },
            path: 'task/:taskId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/agent/_layout'),
          'Desktop > Chat > Layout',
        ),
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
            element: groupChatElement,
            handle: { meta: groupRouteMeta },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/group/profile'),
              'Desktop > Agent Group > Profile',
            ),
            path: 'profile',
          },
          {
            element: groupChatElement,
            handle: { meta: groupRouteMeta },
            path: ':topicId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/group/_layout'),
          'Desktop > Group > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: ':gid',
      },
    ],
    path: 'group',
  },

  // Discover routes with nested structure
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/community/(detail)/workspace/settings'),
          'Desktop > Discover > Workspace > Settings',
        ),
        path: 'workspace/settings',
      },
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/home'),
              'Desktop > Discover > List > Home',
            ),
            handle: {
              meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discover' }),
            },
            path: 'home',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/agent'),
                  'Desktop > Discover > List > Agent',
                ),
                handle: {
                  meta: routeMeta({
                    icon: ShapesIcon,
                    titleKey: 'navigation.discoverAssistants',
                  }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/agent/_layout'),
              'Desktop > Discover > List > Agent > Layout',
            ),
            path: 'agent',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/skill'),
                  'Desktop > Discover > List > Skill',
                ),
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discover' }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/skill/_layout'),
              'Desktop > Discover > List > Skill > Layout',
            ),
            path: 'skill',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/mcp'),
                  'Desktop > Discover > List > MCP',
                ),
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverMcp' }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/mcp/_layout'),
              'Desktop > Discover > List > MCP > Layout',
            ),
            path: 'mcp',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/workspace'),
              'Desktop > Discover > List > Workspace',
            ),
            path: 'workspace',
          },
          { element: redirectElement('home'), index: true },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/community/(list)/_layout'),
          'Desktop > Discover > List > Layout',
        ),
      },
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/agent'),
              'Desktop > Discover > Detail > Agent',
            ),
            path: 'agent/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/group_agent'),
              'Desktop > Discover > Detail > Group Agent',
            ),
            path: 'group_agent/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/skill'),
              'Desktop > Discover > Detail > Skill',
            ),
            path: 'skill/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/mcp'),
              'Desktop > Discover > Detail > MCP',
            ),
            path: 'mcp/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/user'),
              'Desktop > Discover > Detail > User',
            ),
            path: 'user/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/organization'),
              'Desktop > Discover > Detail > Organization',
            ),
            path: 'org/:slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/community/(detail)/_layout'),
          'Desktop > Discover > Detail > Layout',
        ),
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/community/_layout'),
      'Desktop > Discover > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: 'community',
  },

  // Resource routes
  {
    children: [
      // Home routes (resource list)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Desktop > Resource > Home',
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.resources' }),
            },
            index: true,
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/resource/(home)/_layout'),
          'Desktop > Resource > Home > Layout',
        ),
      },
      // Library routes (knowledge base detail)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library'),
              'Desktop > Resource > Library',
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library/[slug]'),
              'Desktop > Resource > Library > Slug',
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            path: ':slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/resource/library/_layout'),
          'Desktop > Resource > Library > Layout',
        ),
        path: 'library/:id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/resource/_layout'),
      'Desktop > Resource > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: 'resource',
  },

  // Memory routes
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/(home)'),
          'Desktop > Memory > Home',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/identities'),
          'Desktop > Memory > Identities',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryIdentities' }),
        },
        path: 'identities',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/contexts'),
          'Desktop > Memory > Contexts',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryContexts' }),
        },
        path: 'contexts',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/preferences'),
          'Desktop > Memory > Preferences',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryPreferences' }),
        },
        path: 'preferences',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/experiences'),
          'Desktop > Memory > Experiences',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryExperiences' }),
        },
        path: 'experiences',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/activities'),
          'Desktop > Memory > Activities',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        path: 'activities',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/memory/_layout'),
      'Desktop > Memory > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: 'memory',
  },

  // Company feedback
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/feedback'), 'Desktop > Feedback'),
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
        element: dynamicElement(() => import('@/routes/(main)/functions'), 'Desktop > Functions'),
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.functions' }),
        },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/functions/lingxing-ads'),
          'Desktop > Functions > Lingxing Ads',
        ),
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.lingxingAds' }),
        },
        path: 'lingxing-ads',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/functions/amazon-old-product-keyword-analysis'),
          'Desktop > Functions > Amazon KW',
        ),
        handle: {
          meta: routeMeta({
            icon: LayoutGridIcon,
            titleKey: 'navigation.amazonOldProductKeyword',
          }),
        },
        path: 'amazon-old-product-keyword-analysis',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/functions/amazon-old-product-keyword-analysis/[runId]'),
          'Desktop > Functions > Amazon KW Run',
        ),
        handle: {
          meta: routeMeta({
            icon: LayoutGridIcon,
            titleKey: 'navigation.amazonOldProductKeyword',
          }),
        },
        path: 'amazon-old-product-keyword-analysis/:runId',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/functions/[functionId]'),
          'Desktop > Functions > Operations',
        ),
        handle: {
          meta: routeMeta({ icon: LayoutGridIcon, titleKey: 'navigation.functions' }),
        },
        path: ':functionId',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/functions/[functionId]/[runId]'),
          'Desktop > Functions > Operations Run',
        ),
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
            element: dynamicElement(() => import('@/routes/(main)/tasks'), 'Desktop > Tasks'),
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
            element: dynamicElement(
              () => import('@/routes/(main)/task/[taskId]'),
              'Desktop > Task Detail',
            ),
            handle: { meta: taskRouteMeta },
            path: ':taskId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'task',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(task-workspace)/_layout'),
      'Desktop > Task Workspace > Layout',
    ),
  },

  // Pages routes
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/page'), 'Desktop > Page'),
        handle: {
          meta: routeMeta({ icon: FilePenIcon, titleKey: 'navigation.pages' }),
        },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/page/[id]'),
          'Desktop > Page > Detail',
        ),
        handle: { meta: pageRouteMeta },
        path: ':id',
      },
    ],
    element: dynamicLayout(() => import('@/routes/(main)/page/_layout'), 'Desktop > Page > Layout'),
    errorElement: <ErrorBoundary />,
    path: 'page',
  },
];

// Desktop router configuration (declarative mode)
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
                element: dynamicElement(
                  () =>
                    import('@/routes/(main)/settings/provider').then((m) => m.ProviderDetailPage),
                  'Desktop > Settings > Provider > Detail',
                ),
                handle: {
                  meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
                },
                path: ':providerId',
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/settings/provider').then((m) => m.ProviderLayout),
              'Desktop > Settings > Provider > Layout',
            ),
            handle: {
              meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
            },
            path: 'provider',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/settings'),
              'Desktop > Settings > Memory',
            ),
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
            element: dynamicElement(
              () => import('@/routes/(main)/settings'),
              'Desktop > Settings > Tab',
            ),
            handle: { meta: settingsRouteMeta },
            path: ':tab',
          },
          // Tabs that need a sub-segment reuse the same tab page; nested feature
          // components read `:sub` via useParams.
          {
            element: dynamicElement(
              () => import('@/routes/(main)/settings'),
              'Desktop > Settings > Tab > Sub',
            ),
            handle: { meta: settingsRouteMeta },
            path: ':tab/:sub',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/settings/_layout'),
          'Desktop > Settings > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/company/invite/[token]'),
          'Desktop > Company > Invitation',
        ),
        path: 'company/invite/:token',
      },

      // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
      // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
      {
        children: [
          // Workspace home — handled by the persistent `DesktopHomeLayout` at
          // the outer main layout (mirrors how `/` index is empty here). Adding
          // an element would render Home twice on top of `DesktopHomeLayout`.
          {
            handle: { meta: workspaceHomeRouteMeta },
            index: true,
          },
          ...sharedMainAreaChildren,
          // Workspace settings — `/:slug/settings/*`. Dedicated layout with its
          // own sidebar (workspace avatar + 6 tabs + back-to-chat), fully
          // decoupled from personal `/settings/*`.
          {
            children: [
              {
                element: redirectElement('general'),
                index: true,
              },
              // Full-bleed tabs render directly inside the workspace settings
              // shell (sidebar + outlet) — they own their internal layout.
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/provider'),
                  'Desktop > Workspace > Settings > Provider',
                ),
                path: 'provider',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/skill'),
                  'Desktop > Workspace > Settings > Skill',
                ),
                path: 'skill',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/connector'),
                  'Desktop > Workspace > Settings > Connector',
                ),
                path: 'connector',
              },
              // Padded tabs share a centered, max-width container layout.
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/general'),
                      'Desktop > Workspace > Settings > General',
                    ),
                    path: 'general',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/departments'),
                      'Desktop > Workspace > Settings > Departments',
                    ),
                    path: 'departments',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/members'),
                      'Desktop > Workspace > Settings > Members',
                    ),
                    path: 'members',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/stats'),
                      'Desktop > Workspace > Settings > Stats',
                    ),
                    path: 'stats',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/plans'),
                      'Desktop > Workspace > Settings > Plans',
                    ),
                    path: 'plans',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/credits'),
                      'Desktop > Workspace > Settings > Credits',
                    ),
                    path: 'credits',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/usage'),
                      'Desktop > Workspace > Settings > Usage',
                    ),
                    path: 'usage',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/service-model'),
                      'Desktop > Workspace > Settings > Service Model',
                    ),
                    path: 'service-model',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/creds'),
                      'Desktop > Workspace > Settings > Creds',
                    ),
                    path: 'creds',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/apikey'),
                      'Desktop > Workspace > Settings > API Key',
                    ),
                    path: 'apikey',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/audit-log'),
                      'Desktop > Workspace > Settings > Audit Log',
                    ),
                    path: 'audit-log',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/storage'),
                      'Desktop > Workspace > Settings > Storage',
                    ),
                    path: 'storage',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/devices'),
                      'Desktop > Workspace > Settings > Devices',
                    ),
                    path: 'devices',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/profile'),
                      'Desktop > Workspace > Settings > Profile',
                    ),
                    path: 'profile',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/appearance'),
                      'Desktop > Workspace > Settings > Appearance',
                    ),
                    path: 'appearance',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/hotkey'),
                      'Desktop > Workspace > Settings > Hotkey',
                    ),
                    path: 'hotkey',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
                      'Desktop > Workspace > Settings > Notification',
                    ),
                    path: 'notification',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/memory'),
                      'Desktop > Workspace > Settings > Memory',
                    ),
                    path: 'memory',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/recommended-examples'),
                      'Desktop > Workspace > Settings > Recommended Examples',
                    ),
                    path: 'recommended-examples',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/referral'),
                      'Desktop > Workspace > Settings > Referral',
                    ),
                    path: 'referral',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/proxy'),
                      'Desktop > Workspace > Settings > Proxy',
                    ),
                    path: 'proxy',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/system-tools'),
                      'Desktop > Workspace > Settings > System Tools',
                    ),
                    path: 'system-tools',
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/[workspaceSlug]/settings/advanced'),
                      'Desktop > Workspace > Settings > Advanced',
                    ),
                    path: 'advanced',
                  },
                ],
                element: dynamicLayout(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/_content-layout'),
                  'Desktop > Workspace > Settings > Content Layout',
                ),
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/[workspaceSlug]/settings/_layout'),
              'Desktop > Workspace > Settings > Layout',
            ),
            errorElement: <ErrorBoundary />,
            path: 'settings',
          },
          // Legacy `/:slug/billing/*` URLs — redirect to the corresponding
          // `/:slug/settings/*` page. Kept for deep-links and bookmarks.
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/[workspaceSlug]/_layout'),
          'Desktop > Workspace > Layout',
        ),
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
    element: dynamicLayout(() => import('@/routes/(main)/_layout'), 'Desktop > Main > Layout'),
    errorElement: <ErrorBoundary />,
    path: '/',
  },
  // Onboarding route (outside main layout)

  ...BusinessDesktopRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/share/t/[id]'), 'Desktop > Share > Topic'),
        handle: { meta: shareTopicRouteMeta },
        path: ':id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/share/t/[id]/_layout'),
      'Desktop > Share > Topic > Layout',
    ),
    path: '/share/t',
  },

  // Share page route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/share/page/[id]'), 'Desktop > Share > Page'),
        path: ':id',
      },
    ],
    path: '/share/page',
  },

  // Messenger verify route (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/verify-im'), 'Desktop > VerifyIm'),
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  // Verify report workspace — standalone master-detail (outside main layout)
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/verify/empty'),
          'Desktop > Verify Empty',
        ),
        index: true,
      },
      {
        element: dynamicElement(() => import('@/routes/verify/[runId]'), 'Desktop > VerifyReport'),
        handle: { meta: verifyRouteMeta },
        path: ':runId',
      },
    ],
    element: dynamicElement(() => import('@/routes/(main)/verify'), 'Desktop > Verify'),
    errorElement: <ErrorBoundary />,
    handle: { meta: verifyReportsRouteMeta },
    path: '/verify',
  },

  // Devtools route (outside main layout, dev-only)
  ...(__DEV__
    ? [
        {
          children: [
            {
              element: dynamicElement(
                () => import('@/routes/(main)/devtools'),
                'Desktop > Devtools > Index',
              ),
              index: true,
            },
            {
              element: dynamicElement(
                () => import('@/routes/(main)/devtools/[identifier]'),
                'Desktop > Devtools > Toolset',
              ),
              path: ':identifier',
            },
          ],
          element: dynamicLayout(
            () => import('@/routes/(main)/devtools/_layout'),
            'Desktop > Devtools > Layout',
          ),
          errorElement: <ErrorBoundary />,
          path: '/devtools',
        },
      ]
    : []),
];

desktopRoutes.push({
  element: dynamicElement(() => import('@/routes/onboarding'), 'Desktop > Onboarding'),
  errorElement: <ErrorBoundary />,
  path: '/onboarding',
});

desktopRoutes.push({
  element: dynamicElement(
    () => import('@/routes/onboarding/agent'),
    'Desktop > Onboarding > Agent',
  ),
  errorElement: <ErrorBoundary />,
  path: '/onboarding/agent',
});

desktopRoutes.push({
  element: dynamicElement(
    () => import('@/routes/onboarding/classic'),
    'Desktop > Onboarding > Classic',
  ),
  errorElement: <ErrorBoundary />,
  path: '/onboarding/classic',
});
