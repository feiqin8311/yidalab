export interface ScheduleNextTopicParams {
  delay?: number; // delay in seconds, default 0
  taskId: string;
  userId: string;
  /** When set, V2 canary can block legacy ticks for in-scope workspaces. */
  workspaceId?: string | null;
}

export interface TaskSchedulerImpl {
  cancelScheduled: (scheduleId: string) => Promise<void>;

  scheduleNextTopic: (params: ScheduleNextTopicParams) => Promise<string>;
}
