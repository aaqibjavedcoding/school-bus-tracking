import React from 'react';
// @ts-expect-error — no type declarations are shipped for the deprecated renderer; jest-expo provides it.
import { create, act } from 'react-test-renderer';
import { LIVE_TRACKING_EVENTS } from '@school-bus-tracking/shared-types';
import { useLiveTrip } from '../src/socket/use-live-trip';

/**
 * Reconnect behaviour of the live-tracking observer (Task 23 §E/F): the
 * server keeps rooms per socket, so a reconnected client MUST re-emit
 * `tracking:join`. Everything here runs against a fake socket — no network.
 */

jest.mock('../src/services/sockets', () => ({
  getSocketHub: () => ({
    socketFor: () => (globalThis as Record<string, unknown>).__fakeSocket as never,
  }),
}));

class FakeSocket {
  connected = false;
  connectCalls = 0;
  emitted: Array<{ event: string; payload: unknown; ack?: (a: unknown) => void }> = [];
  private listeners = new Map<string, Set<(arg?: unknown) => void>>();

  on(event: string, fn: (arg?: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
  }

  off(event: string, fn: (arg?: unknown) => void): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, payload: unknown, ack?: (a: unknown) => void): void {
    this.emitted.push({ event, payload, ack });
  }

  connect(): void {
    this.connectCalls += 1;
    this.connected = true;
    this.trigger('connect');
  }

  trigger(event: string, arg?: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) {
      fn(arg);
    }
  }

  joins(): Array<{ event: string; payload: unknown }> {
    return this.emitted.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.join);
  }

  ackJoin(ack: unknown): void {
    const last = [...this.emitted]
      .reverse()
      .find((entry) => entry.event === LIVE_TRACKING_EVENTS.join);
    last?.ack?.(ack);
  }
}

let socket: FakeSocket;
const TRIPOK = '3f2b7a10-9a3e-4d47-9e6a-5d9c6f1e2b34';

function renderHook<T>(hook: () => T): { current: () => T; unmount: () => void } {
  let value: T;
  const Wrapper = (): React.ReactElement | null => {
    value = hook();
    return null;
  };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(Wrapper));
  });
  return {
    current: () => value!,
    unmount: () => act(() => tree.unmount()),
  };
}

// Safe to import normally: jest.mock above is hoisted and the hook resolves
// the hub lazily inside its effect.

beforeEach(() => {
  socket = new FakeSocket();
  (globalThis as Record<string, unknown>).__fakeSocket = socket;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__fakeSocket;
});

describe('useLiveTrip room membership', () => {
  it('joins immediately when the socket is already connected — with ONLY the trip id', () => {
    socket.connected = true;
    const view = renderHook(() => useLiveTrip(TRIPOK));
    expect(socket.joins()).toHaveLength(1);
    expect(socket.joins()[0].payload).toEqual({ trip_id: TRIPOK });
    view.unmount();
  });

  it('connects the socket when idle, then joins on the connect event', () => {
    const view = renderHook(() => useLiveTrip(TRIPOK));
    expect(socket.connectCalls).toBe(1);
    expect(socket.joins()).toHaveLength(1); // connect() triggers 'connect'
    expect(view.current().connection).toBe('live');
    view.unmount();
  });

  it('RE-JOINS after a reconnect (rooms are per-socket on the server)', () => {
    socket.connected = true;
    const view = renderHook(() => useLiveTrip(TRIPOK));
    expect(socket.joins()).toHaveLength(1);

    act(() => {
      socket.connected = false;
      socket.trigger('disconnect');
    });
    expect(view.current().connection).toBe('reconnecting');

    act(() => {
      socket.connected = true;
      socket.trigger('connect');
    });
    const joins = socket.joins();
    expect(joins).toHaveLength(2);
    expect(joins[1].payload).toEqual({ trip_id: TRIPOK });
    expect(view.current().connection).toBe('live');
    view.unmount();
  });

  it('records a denied join (e.g. trip not open) without crashing', () => {
    socket.connected = true;
    const view = renderHook(() => useLiveTrip(TRIPOK));
    act(() => {
      socket.ackJoin({ status: 'denied', reason: 'trip_not_open' });
    });
    expect(view.current().joinDenied).toBe('trip_not_open');
    expect(view.current().fix).toBeNull();
    view.unmount();
  });

  it('applies the join ack (latest fix + tracking state) and later broadcasts', () => {
    socket.connected = true;
    const view = renderHook(() => useLiveTrip(TRIPOK));
    act(() => {
      socket.ackJoin({
        status: 'joined',
        trip_id: TRIPOK,
        tracking_state: 'LIVE',
        trip_status: 'IN_PROGRESS',
        latest: {
          latitude: 1.5,
          longitude: 2.5,
          speed: 12,
          heading: 45,
          accuracy: 5,
          recorded_at: '2026-08-29T06:31:00.000Z',
          received_at: '2026-08-29T06:31:01.000Z',
        },
      });
    });
    expect(view.current().fix).toMatchObject({ latitude: 1.5, longitude: 2.5 });
    expect(view.current().tripStatus).toBe('IN_PROGRESS');
    expect(view.current().noLocationYet).toBe(false);

    act(() => {
      socket.trigger(LIVE_TRACKING_EVENTS.locationUpdate, {
        trip_id: TRIPOK,
        latitude: 3.5,
        longitude: 4.5,
        speed: 20,
        heading: 90,
        accuracy: 6,
        recorded_at: '2026-08-29T06:32:00.000Z',
        received_at: '2026-08-29T06:32:00.500Z',
        tracking_state: 'LIVE',
        trip_status: 'IN_PROGRESS',
      });
    });
    expect(view.current().fix).toMatchObject({ latitude: 3.5 });

    act(() => {
      socket.trigger(LIVE_TRACKING_EVENTS.stopArrived, {
        trip_id: TRIPOK,
        school_id: 'ignored-by-the-hook',
        stop_id: 'stop-9',
        stop_name: 'Elm Street',
        arrived_at: '2026-08-29T06:33:00.000Z',
        trip_status: 'IN_PROGRESS',
        tracking_state: 'LIVE',
      });
    });
    expect(view.current().lastArrival?.stop_name).toBe('Elm Street');
    view.unmount();
  });

  it('marks noLocationYet when the trip is open but nothing was ever reported', () => {
    socket.connected = true;
    const view = renderHook(() => useLiveTrip(TRIPOK));
    act(() => {
      socket.ackJoin({
        status: 'joined',
        trip_id: TRIPOK,
        tracking_state: 'AWAITING_FIRST_FIX',
        trip_status: 'BOARDING',
        latest: null,
      });
    });
    expect(view.current().noLocationYet).toBe(true);
    expect(view.current().fix).toBeNull();
    view.unmount();
  });

  it('leaves the room on unmount (and only after the server accepted the join)', () => {
    socket.connected = true;
    const view = renderHook(() => useLiveTrip(TRIPOK));
    act(() => {
      socket.ackJoin({ status: 'joined', trip_id: TRIPOK, latest: null });
    });
    view.unmount();
    const leaves = socket.emitted.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.leave);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].payload).toEqual({ trip_id: TRIPOK });
  });

  it('a null trip id keeps everything idle (no join, no socket use)', () => {
    const view = renderHook(() => useLiveTrip(null));
    expect(socket.emitted).toHaveLength(0);
    expect(view.current().connection).toBe('offline');
    view.unmount();
  });
});
