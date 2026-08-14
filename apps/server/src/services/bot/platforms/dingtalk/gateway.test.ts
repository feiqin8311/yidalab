import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

import { DingTalkStreamConnection } from './gateway';

type EventHandler = (...args: unknown[]) => void;

interface MockListener {
  handler: EventHandler;
  once: boolean;
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close', 1000, Buffer.alloc(0));
  });
  private readonly listeners = new Map<string, MockListener[]>();
  readonly ping = vi.fn();
  readyState = 0;
  readonly send = vi.fn();
  readonly terminate = vi.fn(() => {
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  emit(type: string, ...args: unknown[]): void {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const listener of listeners) listener.handler(...args);
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((listener) => !listener.once),
    );
  }

  on(type: string, handler: EventHandler): this {
    this.addListener(type, handler, false);
    return this;
  }

  once(type: string, handler: EventHandler): this {
    this.addListener(type, handler, true);
    return this;
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  pong(): void {
    this.emit('pong');
  }

  private addListener(type: string, handler: EventHandler, once: boolean): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ handler, once });
    this.listeners.set(type, listeners);
  }
}

const createSocket = (url: string) => new MockWebSocket(url) as unknown as WebSocket;

const gatewayResponse = () =>
  new Response(JSON.stringify({ endpoint: 'wss://stream.example', ticket: 'ticket' }));

describe('DingTalkStreamConnection', () => {
  afterEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries a transient failure during the initial connection', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(gatewayResponse());
    vi.stubGlobal('fetch', fetch);
    const connection = new DingTalkStreamConnection(
      'app-initial-retry',
      'secret',
      'https://local.example/webhook',
      createSocket,
    );

    const startPromise = connection.start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].open();

    await expect(startPromise).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    connection.stop();
  });

  it('reconnects when DingTalk sends the SYSTEM disconnect topic', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => gatewayResponse());
    vi.stubGlobal('fetch', fetch);
    const connection = new DingTalkStreamConnection(
      'app-system-disconnect',
      'secret',
      'https://local.example/webhook',
      createSocket,
    );

    const startPromise = connection.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].open();
    await startPromise;

    MockWebSocket.instances[0].emit(
      'message',
      JSON.stringify({
        data: '{}',
        headers: { messageId: 'system-1', topic: 'disconnect' },
        type: 'SYSTEM',
      }),
    );
    expect(MockWebSocket.instances[0].close).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    MockWebSocket.instances[1].open();

    expect(fetch).toHaveBeenCalledTimes(2);
    connection.stop();
  });

  it('acknowledges DingTalk SYSTEM ping with the original messageId and opaque data', async () => {
    const fetch = vi.fn().mockImplementation(async () => gatewayResponse());
    vi.stubGlobal('fetch', fetch);
    const connection = new DingTalkStreamConnection(
      'app-system-ping',
      'secret',
      'https://local.example/webhook',
      createSocket,
    );

    const startPromise = connection.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.open();
    await startPromise;

    const pingData = JSON.stringify({ opaque: 'opaque-1' });
    socket.emit(
      'message',
      JSON.stringify({
        data: pingData,
        headers: { messageId: 'ping-1', topic: 'ping' },
        type: 'SYSTEM',
      }),
    );

    expect(socket.send).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.send.mock.calls[0][0] as string)).toEqual({
      code: 200,
      data: pingData,
      headers: { contentType: 'application/json', messageId: 'ping-1' },
      message: 'OK',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(socket.close).not.toHaveBeenCalled();
    connection.stop();
  });

  it('forces a reconnect after twenty seconds without a pong', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => gatewayResponse());
    vi.stubGlobal('fetch', fetch);
    const connection = new DingTalkStreamConnection(
      'app-heartbeat',
      'secret',
      'https://local.example/webhook',
      createSocket,
    );

    const startPromise = connection.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].open();
    await startPromise;

    await vi.advanceTimersByTimeAsync(20_000);
    expect(MockWebSocket.instances[0].ping).toHaveBeenCalledOnce();
    expect(MockWebSocket.instances[0].terminate).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    MockWebSocket.instances[1].open();
    connection.stop();
  });

  it('keeps the connection healthy when pong frames arrive', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => gatewayResponse());
    vi.stubGlobal('fetch', fetch);
    const connection = new DingTalkStreamConnection(
      'app-heartbeat-pong',
      'secret',
      'https://local.example/webhook',
      createSocket,
    );

    const startPromise = connection.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].open();
    await startPromise;

    await vi.advanceTimersByTimeAsync(10_000);
    MockWebSocket.instances[0].pong();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(MockWebSocket.instances[0].ping).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances[0].terminate).not.toHaveBeenCalled();
    connection.stop();
  });

  it('cancels heartbeat and a pending reconnect when stopped', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => gatewayResponse());
    vi.stubGlobal('fetch', fetch);
    const connection = new DingTalkStreamConnection(
      'app-stop',
      'secret',
      'https://local.example/webhook',
      createSocket,
    );

    const startPromise = connection.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].open();
    await startPromise;
    MockWebSocket.instances[0].close();

    connection.stop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances[0].ping).not.toHaveBeenCalled();
  });
});
