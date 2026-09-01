import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectSocketWithToken } from './socket-auth.ts';

function fakeSocket(connected = false) {
  const socket = {
    connected,
    connects: 0,
    connect() {
      socket.connects += 1;
      socket.connected = true;
    },
  };
  return socket;
}

/**
 * Regression guard for the gateway warnings
 *
 * ```text
 * WARN [EmergenciesGateway]  Rejected unauthenticated emergency socket
 * WARN [LiveTrackingGateway] Rejected unauthenticated tracking socket
 * ```
 *
 * Both gateways authenticate the handshake with the in-memory JWT. The web
 * client used to call `socket.connect()` unconditionally, so a screen that
 * still held a socket after the session was gone (sign-out, or a refresh the
 * CSRF regression turned into a 403) handed the gateway an empty
 * `access_token` and was refused.
 */
describe('connectSocketWithToken', () => {
  it('does not open a handshake the gateway is guaranteed to reject', () => {
    const socket = fakeSocket();

    assert.equal(connectSocketWithToken(socket, null), false);
    assert.equal(socket.connects, 0);
    assert.equal(socket.connected, false);
  });

  it('treats an empty token as anonymous', () => {
    const socket = fakeSocket();

    assert.equal(connectSocketWithToken(socket, ''), false);
    assert.equal(socket.connects, 0);
  });

  it('connects once the session holds an access token', () => {
    const socket = fakeSocket();

    assert.equal(connectSocketWithToken(socket, 'jwt'), true);
    assert.equal(socket.connects, 1);
  });

  it('never opens a second connection on an already connected socket', () => {
    const socket = fakeSocket(true);

    assert.equal(connectSocketWithToken(socket, 'jwt'), true);
    assert.equal(socket.connects, 0);
  });
});
