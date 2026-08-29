import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  LIVE_TRACKING_NAMESPACE,
  NOTIFICATIONS_NAMESPACE,
} from '@school-bus-tracking/shared-types';
import { socketOrigin } from './api.ts';
import { buildNamespaceSocketConfig } from './socket-options.ts';
import { setAccessToken } from './session.ts';
import {
  disconnectLiveTrackingSocket,
  getLiveTrackingSocket,
  isLiveTrackingSocketConnected,
} from './live-tracking-socket.ts';
import { disconnectNotificationsSocket, getNotificationsSocket } from './notifications-socket.ts';

/**
 * Integration wiring guards for the two Socket.IO namespaces the mobile app
 * consumes. These pin the exact client configuration the API gateways
 * expect: the namespace of the existing `/live-tracking` and
 * `/notifications` gateways, the engine.io path, and the JWT bearer token
 * carried in the handshake auth bag (never a cookie, never a query string).
 */

describe('socketOrigin', () => {
  it('derives the socket origin from the REST base URL', () => {
    assert.equal(socketOrigin('http://localhost:3001/api/v1'), 'http://localhost:3001');
    assert.equal(socketOrigin('http://192.168.1.20:3001/api/v1/'), 'http://192.168.1.20:3001');
    assert.equal(socketOrigin('https://api.example.com/api/v1'), 'https://api.example.com');
  });
});

describe('buildNamespaceSocketConfig', () => {
  it('targets the existing namespace on the API origin with the engine.io path', () => {
    const tracking = buildNamespaceSocketConfig(LIVE_TRACKING_NAMESPACE);
    assert.equal(tracking.url, 'http://localhost:3001/live-tracking');
    assert.equal(tracking.options.path, '/socket.io');
    assert.equal(tracking.options.addTrailingSlash, false);
    assert.equal(tracking.options.autoConnect, false);
    assert.deepEqual(tracking.options.transports, ['websocket', 'polling']);
    assert.equal(tracking.options.reconnection, true);
    assert.equal(tracking.options.reconnectionAttempts, Infinity);
  });

  it('hands the in-memory JWT to the handshake auth callback at call time', () => {
    const { options } = buildNamespaceSocketConfig(NOTIFICATIONS_NAMESPACE);
    setAccessToken('token-123');
    let handed: { access_token: string } | null = null;
    options.auth((data) => {
      handed = data;
    });
    assert.equal(handed!.access_token, 'token-123');

    setAccessToken(null);
    let cleared: { access_token: string } | null = null;
    options.auth((data) => {
      cleared = data;
    });
    assert.equal(cleared!.access_token, '');
  });
});

describe('socket singletons', () => {
  afterEach(() => {
    disconnectLiveTrackingSocket();
    disconnectNotificationsSocket();
  });

  it('shares one live-tracking socket process-wide and never auto-connects it', () => {
    const socket = getLiveTrackingSocket();
    assert.equal(getLiveTrackingSocket(), socket);
    assert.equal(socket.connected, false);
    assert.equal(isLiveTrackingSocketConnected(), false);
  });

  it('shares one notifications socket process-wide', () => {
    const socket = getNotificationsSocket();
    assert.equal(getNotificationsSocket(), socket);
    assert.equal(socket.connected, false);
  });
});
