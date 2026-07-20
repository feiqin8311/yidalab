import { OtelQstashClient } from '@/libs/qstash';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

/**
 * Optional legacy helper for Upstash Workflow `serve()`.
 * Returns null when QSTASH_TOKEN is unset (YidaLab default: Redis jobs).
 */
export const createWorkflowQstashClient = (): OtelQstashClient | null => {
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) return null;

  return new OtelQstashClient({
    headers: { ...upstashWorkflowExtraHeaders },
    token,
  });
};

export { upstashWorkflowExtraHeaders };
