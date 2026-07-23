/**
 * Tab identifiers for the workspace-scoped settings surface
 * (`/:workspaceSlug/settings/*`).
 *
 * The unified settings tree (post-merge) absorbs every former personal
 * `SettingsTabs` entry. To avoid colliding with URLs that used to live
 * under `/settings/<tab>`, keep the values aligned with the legacy
 * personal `SettingsTabs` enum (see `src/store/global/initialState.ts`).
 * Anything truly workspace-only — Members / Storage / AuditLog / APIKey —
 * keeps the original kebab-case id.
 */
export enum WorkspaceSettingsTabs {
  Advanced = 'advanced',
  APIKey = 'apikey',
  Appearance = 'appearance',
  AuditLog = 'audit-log',
  Billing = 'billing',
  Connector = 'connector',
  Credits = 'credits',
  Creds = 'creds',
  Departments = 'departments',
  Devices = 'devices',
  General = 'general',
  Hotkey = 'hotkey',
  Members = 'members',
  Memory = 'memory',
  Notification = 'notification',
  Plans = 'plans',
  Profile = 'profile',
  Provider = 'provider',
  Proxy = 'proxy',
  /** Company-wide home / agent welcome chips — under Memory in the sidebar. */
  RecommendedExamples = 'recommended-examples',
  Referral = 'referral',
  ServiceModel = 'service-model',
  Skill = 'skill',
  Stats = 'stats',
  Storage = 'storage',
  SystemTools = 'system-tools',
  Usage = 'usage',
}

export const DEFAULT_WORKSPACE_SETTINGS_TAB = WorkspaceSettingsTabs.General;
