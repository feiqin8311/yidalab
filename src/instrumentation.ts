export async function register() {
  // In local development, write debug logs to logs/server.log
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./libs/debug-file-logger');
  }

  // Auto-start GatewayManager on server start for non-Vercel environments (Docker, local).
  // Persistent bots (e.g. DingTalk Stream) need reconnection after restart.
  // On Vercel, the cron job at /api/agent/gateway handles this instead.
  // Default on in local dev too; set ENABLE_BOT_IN_DEV=0 only if this machine
  // must not hold Stream bindings (another env owns the same bot apps).
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.DATABASE_URL &&
    !process.env.VERCEL_ENV &&
    process.env.ENABLE_BOT_IN_DEV !== '0'
  ) {
    const { GatewayService } = await import('@/server/services/gateway');
    const service = new GatewayService();
    service.ensureRunning().catch((err) => {
      console.error('[Instrumentation] Failed to auto-start GatewayManager:', err);
    });
  }

  // Note: messenger system bot connections (Discord/Telegram) are managed
  // entirely from dc-center's System Bots admin — save / enable / forceReconnect
  // mutations call MessageGateway directly. The main app's only role here is
  // to receive forwarded events at `/api/agent/messenger/webhooks/<platform>`,
  // which doesn't require any startup work.

  // Daily memory analysis at 18:30 (Asia/Shanghai by default). Requires Redis.
  // See MEMORY_DAILY_ANALYSIS_* env vars. Multi-instance safe via Redis NX lock.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    void import('@/server/services/memory/userMemory/dailyCron')
      .then(({ startMemoryDailyCron }) => startMemoryDailyCron())
      .catch((err) => {
        console.error('[Instrumentation] Failed to start memory daily cron:', err);
      });
  }

  // Task schedule (cron) sweep — replaces original QStash */10 schedule that
  // POSTed /api/workflows/task/schedule-dispatch. Without this, task-page
  // "定时计划" is saved but never fires. Opt out: TASK_SCHEDULE_DISPATCH_CRON=0.
  // When TASK_SCHEDULER_V2=on the V2 loop owns dispatch; legacy cron stays as
  // a fallback only when V2 is off/shadow.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    void import('@/server/services/taskRunner/scheduleDispatchCron')
      .then(async ({ startScheduleDispatchCron }) => {
        const { isTaskSchedulerV2On } = await import('@/server/services/taskAutomation');
        if (!isTaskSchedulerV2On()) startScheduleDispatchCron();
      })
      .catch((err) => {
        console.error('[Instrumentation] Failed to start schedule-dispatch cron:', err);
      });

    void import('@/server/services/taskAutomation/loop')
      .then(({ startTaskAutomationLoop }) => startTaskAutomationLoop())
      .catch((err) => {
        console.error('[Instrumentation] Failed to start task-automation V2 loop:', err);
      });
  }

  if (process.env.NODE_ENV !== 'production' && !process.env.ENABLE_TELEMETRY_IN_DEV) {
    return;
  }

  const shouldEnable = process.env.ENABLE_TELEMETRY && process.env.NEXT_RUNTIME === 'nodejs';
  if (!shouldEnable) {
    return;
  }

  await import('./instrumentation.node');
}
