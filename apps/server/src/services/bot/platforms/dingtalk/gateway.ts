import debug from 'debug';

const log = debug('bot-platform:dingtalk:gateway');
const GATEWAY_URL = 'https://api.dingtalk.com/v1.0/gateway/connections/open';
const ROBOT_TOPIC = '/v1.0/im/bot/messages/get';

interface DingTalkGatewayMessage {
  data: string;
  headers: { messageId: string; topic: string };
  type: 'CALLBACK' | 'SYSTEM';
}

export class DingTalkStreamConnection {
  private socket?: WebSocket;
  private stopped = false;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly webhookUrl: string,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    const response = await fetch(GATEWAY_URL, {
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        subscriptions: [{ topic: ROBOT_TOPIC, type: 'CALLBACK' }],
      }),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok)
      throw new Error(`DingTalk gateway connection failed: HTTP ${response.status}`);
    const { endpoint, ticket } = await response.json();
    if (!endpoint || !ticket) throw new Error('DingTalk gateway returned no endpoint');

    const socket = new WebSocket(`${endpoint}?ticket=${encodeURIComponent(ticket)}`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener(
        'error',
        () => reject(new Error('DingTalk WebSocket connection failed')),
        { once: true },
      );
    });
    socket.addEventListener('message', (event) => void this.handleMessage(String(event.data)));
    socket.addEventListener('close', () => {
      if (!this.stopped) log('DingTalk Stream connection closed for appId=%s', this.clientId);
    });
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
    this.socket = undefined;
  }

  private async handleMessage(value: string) {
    let message: DingTalkGatewayMessage;
    try {
      message = JSON.parse(value);
    } catch {
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
      this.socket?.send(
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
