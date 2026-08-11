export type JobHandler = (payload: unknown, job: JobRecord) => Promise<void>;

export interface EnqueueOptions {
  /** Optional stable key — re-enqueue replaces an unfinished job with the same key. */
  dedupeKey?: string;
  /** Delay before the job becomes runnable (ms). */
  delayMs?: number;
  maxAttempts?: number;
  name: string;
  payload: unknown;
}

export interface JobRecord {
  attempts: number;
  id: string;
  maxAttempts: number;
  name: string;
  payload: unknown;
  runAt: number;
}

export const JOB_NAMES = {
  agentRuntimeStep: 'agent.runtime.step',
  agentSignalRun: 'agent-signal.run',
  agentSignalNightlyReview: 'agent-signal.nightly-review',
  memoryDaily: 'memory.daily',
  memoryHourly: 'memory.hourly',
  memoryPersonaUpdate: 'memory.persona-update',
  memoryProcessTopic: 'memory.process-topic',
  memoryProcessTopics: 'memory.process-topics',
  memoryProcessUserTopics: 'memory.process-user-topics',
  memoryProcessUsers: 'memory.process-users',
  taskHeartbeatTick: 'task.heartbeat-tick',
  taskScheduleExecute: 'task.schedule-execute',
  taskScheduleDispatch: 'task.schedule-dispatch',
  taskWatchdog: 'task.watchdog',
  opsFunctionComplete: 'ops.function.on-complete',
  verifyComplete: 'verify.on-complete',
} as const;
