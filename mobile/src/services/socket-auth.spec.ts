import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearAccessToken, setAccessToken } from './session.ts';
import { connectAuthenticatedSocket } from './socket-auth.ts';

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
 * Mobile counterpart of the web guard.
 *
 *
 * The gateways authenticate every handshake with the in-memory JWT
 * (`handshake.auth.access_token`) and log
 * `Rejected unauthenticated … socket` when it is missing. A signed-out app
 * must therefore not open the socket at all — the bearer/mobile auth model
 * itself is unchanged.
 */
describe('connectAuthenticatedSocket', () => {
  afterEach(() => {
    clearAccessToken();
  });

  it('does not open a handshake the gateway is guaranteed to reject', () => {
    clearAccessToken();
    const socket = fakeSocket();

    assert.equal(connectAuthenticatedSocket(socket), false);
    assert.equal(socket.connects, 0);
    assert.equal(socket.connected, false);
  });

  it('connects once the session holds an access token', () => {
    setAccessToken('jwt');
    const socket = fakeSocket();

    assert.equal(connectAuthenticatedSocket(socket), true);
    assert.equal(socket.connects, 1);
  });

  it('never opens a second connection on an already connected socket', () => {
    setAccessToken('jwt');
    const socket = fakeSocket(true);

    assert.equal(connectAuthenticatedSocket(socket), true);
    assert.equal(socket.connects, 0);
  });
});
