import debug from 'debug';
import WebSocket from 'ws';

const log = debug('bot-platform:dingtalk:gateway');
const GATEWAY_URL = 'https://api.dingtalk.com/v1.0/gateway/connections/open';
const ROBOT_TOPIC = '/v1.0/im/bot/messages/get';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const INITIAL_CONNECT_MAX_ATTEMPTS = 3;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 20_000;

interface DingTalkGatewayMessage {
  data: string;
  headers: { messageId: string; topic: string };
  type: 'CALLBACK' | 'SYSTEM';
}

type DingTalkSocketFactory = (url: string) => WebSocket;

const sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export class DingTalkStreamConnection {
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private lastPongAt = 0;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private socket?: WebSocket;
  private stopped = false;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly webhookUrl: string,
    private readonly createSocket: DingTalkSocketFactory = (url) => new WebSocket(url),
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    let lastError: unknown;

    for (let attempt = 1; attempt <= INITIAL_CONNECT_MAX_ATTEMPTS; attempt++) {
      if (this.stopped) break;
      try {
        await this.connect();
        return;
      } catch (error) {
        lastError = error;
        console.error(
          `[DingTalk] Initial Stream connection failed (appId=${this.clientId}, attempt=${attempt}/${INITIAL_CONNECT_MAX_ATTEMPTS}):`,
          error,
        );
        if (this.stopped || attempt === INITIAL_CONNECT_MAX_ATTEMPTS) break;
        await sleep(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('DingTalk initial Stream connection failed');
  }

  stop(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  private async connect(): Promise<void> {
    const response = await fetch(GATEWAY_URL, {
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        subscriptions: [{ topic: ROBOT_TOPIC, type: 'CALLBACK' }],
      }),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`DingTalk gateway connection failed: HTTP ${response.status}`);
    }
    const { endpoint, ticket } = (await response.json()) as {
      endpoint?: string;
      ticket?: string;
    };
    if (!endpoint || !ticket) throw new Error('DingTalk gateway returned no endpoint');

    const socket = this.createSocket(`${endpoint}?ticket=${encodeURIComponent(ticket)}`);
    this.socket = socket;
    let opened = false;

    socket.on('message', (data) => void this.handleMessage(String(data), socket));
    socket.on('pong', () => {
      if (this.socket === socket) this.lastPongAt = Date.now();
    });
    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.stopHeartbeat();
      if (!this.stopped && opened) {
        log(
          'DingTalk Stream connection closed appId=%s code=%d reason=%s',
          this.clientId,
          code,
          reason.toString() || 'none',
        );
        this.scheduleReconnect();
      }
    });
    socket.on('error', (error) => {
      console.error(`[DingTalk] Stream socket error (appId=${this.clientId}):`, error);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => {
          opened = true;
          this.reconnectAttempts = 0;
          resolve();
        });
        socket.once('error', () => reject(new Error('DingTalk WebSocket connection failed')));
        socket.once('close', () => {
          if (!opened) reject(new Error('DingTalk WebSocket closed before opening'));
        });
      });
    } catch (error) {
      if (this.socket === socket) this.socket = undefined;
      socket.terminate();
      throw error;
    }

    this.startHeartbeat(socket);
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || this.socket !== socket) {
        this.stopHeartbeat();
        return;
      }

      const silenceMs = Date.now() - this.lastPongAt;
      if (silenceMs >= HEARTBEAT_TIMEOUT_MS || socket.readyState !== WebSocket.OPEN) {
        log(
          'DingTalk Stream heartbeat unhealthy appId=%s silenceMs=%d readyState=%d',
          this.clientId,
          silenceMs,
          socket.readyState,
        );
        this.reconnectUnhealthySocket(socket);
        return;
      }

      try {
        socket.ping();
      } catch (error) {
        console.error(`[DingTalk] Stream heartbeat ping failed (appId=${this.clientId}):`, error);
        this.reconnectUnhealthySocket(socket);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private reconnectUnhealthySocket(socket: WebSocket): void {
    if (this.stopped || this.socket !== socket) return;
    this.stopHeartbeat();
    this.scheduleReconnect();
    socket.terminate();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const attempt = this.reconnectAttempts + 1;
    this.reconnectAttempts = attempt;
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 5),
    );
    log(
      'DingTalk Stream reconnect scheduled appId=%s attempt=%d delayMs=%d',
      this.clientId,
      attempt,
      delay,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        console.error(
          `[DingTalk] Stream reconnect failed (appId=${this.clientId}, attempt=${attempt}):`,
          error,
        );
        this.scheduleReconnect();
      });
    }, delay);
  }

  private async handleMessage(value: string, sourceSocket: WebSocket): Promise<void> {
    let message: DingTalkGatewayMessage;
    try {
      message = JSON.parse(value);
    } catch {
      return;
    }
    if (message.type === 'SYSTEM' && message.headers.topic === 'disconnect') {
      if (this.socket !== sourceSocket || this.stopped) return;
      log('DingTalk Stream server requested disconnect for appId=%s', this.clientId);
      this.scheduleReconnect();
      sourceSocket.close();
      return;
    }
    if (message.type !== 'CALLBACK' || message.headers.topic !== ROBOT_TOPIC) return;

    try {
      await fetch(this.webhookUrl, {
        body: message.data,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      console.error('[DingTalk] Failed to forward bot event:', error);
    } finally {
      if (sourceSocket.readyState === WebSocket.OPEN) {
        sourceSocket.send(
          JSON.stringify({
            code: 200,
            data: JSON.stringify({ status: 'SUCCESS' }),
            headers: { contentType: 'application/json', messageId: message.headers.messageId },
            message: 'OK',
          }),
        );
      }
    }
  }
}
