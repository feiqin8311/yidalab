/**
 * Reads the `HIDDEN_PERSONAL_SETTINGS` env var set by the launcher.
 *
 * Personal settings is the legacy `/settings/*` route. Once the workspace-only
 * settings rollout lands, the desktop main process should hide every entry
 * point that navigates to it (tray, app menu, IPC shortcut).
 *
 * The flag is read from `process.env` (set by the launcher) rather than from
 * the renderer feature-flag store — main process menus are built before the
 * renderer is fully online, and `electron-store` is per-process.
 */
export const isPersonalSettingsHidden = (): boolean =>
  process.env.HIDDEN_PERSONAL_SETTINGS === '1' || process.env.HIDDEN_PERSONAL_SETTINGS === 'true';
