import { recordUpstashWorkflowEvent } from '@lobechat/observability-otel/modules/upstash-workflow';
import { errorNameFrom } from '@lobechat/utils';
import { Client, type PublishRequest, type PublishResponse, Receiver } from '@upstash/qstash';
import { Client as WorkflowClient, type TriggerOptions } from '@upstash/workflow';
import debug from 'debug';

const log = debug('lobe-server:qstash');

const headers = {
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }),
};

const normalizeLabel = (label?: string | string[]): string | undefined =>
  Array.isArray(label) ? label.join(',') : label;

type WorkflowTriggerResponse = { workflowRunId: string };

/**
 * QStash client that records OTEL metrics for outbound JSON publishes.
 *
 * Use when:
 * - Publishing QStash JSON messages from server code
 * - Passing a QStash client into Upstash Workflow `serve()` options
 *
 * Expects:
 * - The base `Client` handles authentication and request serialization
 *
 * Returns:
 * - The same publish response as `@upstash/qstash` `Client.publishJSON`
 */
export class OtelQstashClient extends Client {
  override async publishJSON<
    TBody = unknown,
    TRequest extends PublishRequest<TBody> = PublishRequest<TBody>,
  >(request: TRequest): Promise<PublishResponse<TRequest>> {
    try {
      const response = await super.publishJSON(request);
      recordUpstashWorkflowEvent({
        interface: 'qstash',
        label: normalizeLabel(request.label),
        operation: 'trigger',
        retries: request.retries,
        retryDelay: request.retryDelay,
        status: 'success',
        url: request.url,
      });

      return response;
    } catch (error) {
      recordUpstashWorkflowEvent({
        errorType: errorNameFrom(error) ?? typeof error,
        interface: 'qstash',
        label: normalizeLabel(request.label),
        operation: 'trigger',
        retries: request.retries,
        retryDelay: request.retryDelay,
        status: 'error',
        url: request.url,
      });

      throw error;
    }
  }
}

/**
 * Upstash Workflow client that records OTEL metrics for outbound triggers.
 *
 * Use when:
 * - Triggering Upstash Workflow runs from app code
 * - Preserving the native workflow client API while adding metrics
 *
 * Expects:
 * - Trigger params are either one workflow trigger or a batch of triggers
 *
 * Returns:
 * - The same trigger response shape as `@upstash/workflow` `Client.trigger`
 */
export class OtelWorkflowClient extends WorkflowClient {
  override trigger(params: TriggerOptions): Promise<WorkflowTriggerResponse>;
  override trigger(params: TriggerOptions[]): Promise<WorkflowTriggerResponse[]>;
  override async trigger(
    params: TriggerOptions | TriggerOptions[],
  ): Promise<WorkflowTriggerResponse | WorkflowTriggerResponse[]> {
    const first = Array.isArray(params) ? params[0] : params;
    const count = Array.isArray(params) ? params.length : 1;

    try {
      const response = Array.isArray(params)
        ? await super.trigger(params)
        : await super.trigger(params);

      recordUpstashWorkflowEvent(
        {
          interface: 'workflow',
          label: first?.label,
          operation: 'trigger',
          retries: first?.retries,
          retryDelay: first?.retryDelay,
          status: 'success',
          url: first?.url,
          workflowRunId: Array.isArray(response)
            ? response[0]?.workflowRunId
            : response.workflowRunId,
        },
        count,
      );

      return response;
    } catch (error) {
      recordUpstashWorkflowEvent(
        {
          errorType: errorNameFrom(error) ?? typeof error,
          interface: 'workflow',
          label: first?.label,
          operation: 'trigger',
          retries: first?.retries,
          retryDelay: first?.retryDelay,
          status: 'error',
          url: first?.url,
          workflowRunId: first?.workflowRunId,
        },
        count,
      );

      throw error;
    }
  }
}

/**
 * Lazy QStash / Workflow clients.
 *
 * YidaLab routes async work through Redis internal jobs by default. Constructing
 * Upstash clients at module load with a missing `QSTASH_TOKEN` spams console
 * warnings (`client token is not set` / `QStash token is required for Upstash
 * Workflow!`). Clients are only created when a token is configured and first used.
 */
const getQstashToken = () => process.env.QSTASH_TOKEN?.trim() || '';

let _qstashClient: OtelQstashClient | undefined;
let _workflowClient: OtelWorkflowClient | undefined;

export const getQstashClient = (): OtelQstashClient => {
  const token = getQstashToken();
  if (!token) {
    throw new Error(
      'QSTASH_TOKEN is not set. YidaLab uses Redis internal jobs by default; configure QSTASH_TOKEN only if you still need Upstash.',
    );
  }
  if (!_qstashClient) {
    _qstashClient = new OtelQstashClient({ headers, token });
  }
  return _qstashClient;
};

export const getWorkflowClient = (): OtelWorkflowClient => {
  const token = getQstashToken();
  if (!token) {
    throw new Error(
      'QSTASH_TOKEN is not set. YidaLab uses Redis internal jobs by default; configure QSTASH_TOKEN only if you still need Upstash Workflow.',
    );
  }
  if (!_workflowClient) {
    _workflowClient = new OtelWorkflowClient({ headers, token });
  }
  return _workflowClient;
};

/**
 * Backward-compatible accessors. Prefer {@link getQstashClient} / {@link getWorkflowClient}.
 * Proxy defers construction until a property/method is accessed.
 */
export const qstashClient: OtelQstashClient = new Proxy({} as OtelQstashClient, {
  get(_target, prop, receiver) {
    const client = getQstashClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export const workflowClient: OtelWorkflowClient = new Proxy({} as OtelWorkflowClient, {
  get(_target, prop, receiver) {
    const client = getWorkflowClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/**
 * Verify QStash signature using Receiver.
 * Returns true if signing keys are not configured (verification skipped) or signature is valid.
 */
export async function verifyQStashSignature(request: Request, rawBody: string): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey || !nextSigningKey) {
    log('QStash signature verification disabled (no signing keys configured)');
    return false;
  }

  const signature = request.headers.get('Upstash-Signature');
  if (!signature) {
    log('Missing Upstash-Signature header');
    return false;
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });

  try {
    return await receiver.verify({ body: rawBody, signature });
  } catch (error) {
    log('QStash signature verification failed: %O', error);
    return false;
  }
}
