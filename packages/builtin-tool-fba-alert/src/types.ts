export const FbaAlertIdentifier = 'lobe-fba-alert';

export const FbaAlertApiName = {
  runFbaAlert: 'runFbaAlert',
} as const;

export type FbaAlertApiNameType = (typeof FbaAlertApiName)[keyof typeof FbaAlertApiName];

export type FbaAlertToolMode = 'self' | 'dry_run' | 'upload_only';

export interface RunFbaAlertParams {
  /**
   * dry_run = no DingTalk send; upload_only = dingpan only; self = send only to
   * resolved current user (default). notify_user_ids are never accepted from the model.
   */
  mode?: FbaAlertToolMode;
  /**
   * Alert scope: all | us | ca | jp | eu | ezarc | yplus | ezarc-test | yplus-test
   */
  scope: string;
}
