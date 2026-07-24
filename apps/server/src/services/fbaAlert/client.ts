export type FbaAlertMode = 'self' | 'broadcast' | 'dry_run' | 'upload_only';

export interface FbaAlertJob {
  created_at?: number;
  error?: string | null;
  finished_at?: number | null;
  job_id: string;
  mode?: string;
  notify_user_ids?: string[];
  result?: {
    alert_count: number;
    fetched_count: number;
    /** Main report dingpan preview (qr.dingtalk.com/...). */
    preview_url?: string;
    /** path -> preview url when multiple reports uploaded. */
    preview_urls?: Record<string, string>;
    report_path: string;
    sid_distribution: Record<string, number>;
  } | null;
  scope?: string;
  started_at?: number | null;
  status: 'queued' | 'running' | 'done' | 'failed' | string;
}

export interface RunFbaAlertParams {
  mode: FbaAlertMode;
  /** Required for mode=self — must come from resolveFbaNotifyUserIds, not the LLM. */
  notifyUserIds?: string[];
  scope: string;
}

export interface FbaAlertClientConfig {
  baseUrl: string;
  /** Default 30s for POST/GET; long runs poll separately. */
  timeoutMs?: number;
  token: string;
}

const joinUrl = (base: string, path: string) => {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
};

export class FbaAlertClient {
  constructor(private readonly config: FbaAlertClientConfig) {}

  static fromEnv(
    env: { FBA_ALERT_API_TOKEN?: string; FBA_ALERT_API_URL?: string } = process.env,
  ): FbaAlertClient | null {
    const baseUrl = env.FBA_ALERT_API_URL?.trim();
    const token = env.FBA_ALERT_API_TOKEN?.trim();
    if (!baseUrl || !token) return null;
    return new FbaAlertClient({ baseUrl, token });
  }

  async runAlert(params: RunFbaAlertParams): Promise<FbaAlertJob> {
    const body: Record<string, unknown> = {
      mode: params.mode,
      scope: params.scope,
    };
    if (params.notifyUserIds?.length) {
      body.notify_user_ids = params.notifyUserIds;
    }

    return this.request<FbaAlertJob>('POST', '/v1/alerts/run', body);
  }

  async getJob(jobId: string): Promise<FbaAlertJob> {
    return this.request<FbaAlertJob>('GET', `/v1/alerts/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Poll until done/failed or timeout. Default ~10 min (FBA jobs can be slow).
   */
  async waitForJob(
    jobId: string,
    options?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<FbaAlertJob> {
    const intervalMs = options?.intervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;

    let last: FbaAlertJob | undefined;
    while (Date.now() < deadline) {
      last = await this.getJob(jobId);
      if (last.status === 'done' || last.status === 'failed') return last;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `FBA alert job ${jobId} timed out after ${timeoutMs}ms (last status=${last?.status ?? 'unknown'})`,
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const response = await fetch(joinUrl(this.config.baseUrl, path), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      method,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const detail =
        typeof data === 'object' && data && 'raw' in data
          ? String((data as { raw: string }).raw)
          : text || response.statusText;
      throw new Error(`FBA alert API ${method} ${path} → ${response.status}: ${detail}`);
    }

    return data as T;
  }
}
