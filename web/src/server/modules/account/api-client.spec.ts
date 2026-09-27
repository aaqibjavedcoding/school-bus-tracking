import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';

/**
 * Client contract of the crew account self-service endpoints.
 *
 * The two routes (`PUT` / `DELETE /api/v1/account/me/photo`) already exist;
 * what is pinned here is how the client has to call them, because both rules
 * were a real footgun:
 *
 * 1. the upload is **multipart** under the field `file` the API parses, and
 *    the JSON default `Content-Type` must be stripped so the runtime can
 *    write its own boundary — the same bug the import wizard hit
 *    (`web/src/lib/api-import-multipart.spec.ts`);
 * 2. neither call may carry an id: the API resolves the account from the
 *    verified JWT, so a client that helpfully appended one would be probing.
 *
 * The React Native `{ uri, name, type }` descriptor is covered too: the crew
 * app has no `File`/`Blob` for a camera capture, and that path is the only
 * way its photo reaches the server.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const PHOTO_RESPONSE = {
  success: true,
  data: {
    id: '0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a01',
    profile_photo_key: 'school-1/profile-photos/user-2/abc-photo.jpg',
    profile_photo_updated_at: '2026-09-27T06:00:00.000Z',
  },
};

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(captured: Captured[], body: unknown = PHOTO_RESPONSE): void {
  globalThis.fetch = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    captured.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = (init.headers || {}) as Record<string, string>;
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

describe('ApiClient crew account photo methods', () => {
  it('PUTs the photo as multipart to the id-free account endpoint', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);

    const client = new ApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      getAccessToken: () => 'jwt',
    });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'capture.jpg', {
      type: 'image/jpeg',
    });
    const response = await client.setAccountPhoto(file);

    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.url, 'https://api.example.test/api/v1/account/me/photo');
    assert.equal(captured[0]!.init.method, 'PUT');
    assert.equal(
      headerOf(captured[0]!.init, 'content-type'),
      undefined,
      'the JSON default must be stripped so the multipart boundary survives',
    );
    assert.equal(headerOf(captured[0]!.init, 'authorization'), 'Bearer jwt');

    const body = captured[0]!.init.body as FormData;
    assert.ok(body instanceof FormData, 'the body must be FormData, not a JSON string');
    const part = body.get('file');
    assert.ok(part instanceof File, 'the API reads the upload from the `file` field');
    assert.equal(part.name, 'capture.jpg');
    assert.equal(response.data?.profile_photo_key, PHOTO_RESPONSE.data.profile_photo_key);
  });

  it('accepts the React Native { uri, name, type } descriptor the crew app sends', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await client.setAccountPhoto({
      uri: 'file:///data/user/0/app/cache/Camera/abc.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });

    const body = captured[0]!.init.body as FormData;
    assert.ok(body instanceof FormData);
    // In Node the descriptor is appended as an opaque value; what matters is
    // that it rides under `file` and no JSON Content-Type was set.
    assert.ok(body.has('file'), 'the descriptor is appended under the `file` field');
    assert.equal(headerOf(captured[0]!.init, 'content-type'), undefined);
  });

  it('DELETEs the photo from the same id-free endpoint', async () => {
    const captured: Captured[] = [];
    stubFetch(captured, {
      success: true,
      data: { id: PHOTO_RESPONSE.data.id, profile_photo_key: null, profile_photo_updated_at: null },
    });

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    const response = await client.clearAccountPhoto();

    assert.equal(captured[0]!.url, 'https://api.example.test/api/v1/account/me/photo');
    assert.equal(captured[0]!.init.method, 'DELETE');
    assert.equal(captured[0]!.init.body, undefined, 'a clear carries no body');
    assert.equal(response.data?.profile_photo_key, null);
  });

  it('never puts an account id in the URL (the JWT decides whose photo it is)', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await client.setAccountPhoto({
      uri: 'file:///cache/p.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
    await client.clearAccountPhoto();

    for (const call of captured) {
      assert.equal(new URL(call.url).pathname, '/api/v1/account/me/photo');
    }
  });
});
