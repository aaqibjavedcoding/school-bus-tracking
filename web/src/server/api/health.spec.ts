import 'reflect-metadata';
import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { overrideContainer } from '../container';
import type { HealthService } from '../modules/health/health.service';
import { getHealth, getHealthReady } from './health';
import { invokeRoute } from '../http/route-testing';
import type { EndpointDefinition } from '../http/route-runtime';

/**
 * Public liveness/readiness probes.
 *
 * The container orchestrator and the load balancer call these with no
 * credentials; any route-level auth guard here takes production down during
 * rolling deploys (failing health checks get the pod killed). These specs
 * pin `auth: false` through the real route runtime: no `Authorization`
 * header is ever sent, and both probes must still answer.
 */
describe('public health probes', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  });

  function stubHealthService(handlers: Partial<HealthService>) {
    restores.push(overrideContainer('health', handlers as HealthService));
  }

  it('answers GET /api/v1/health with 200 and no credentials', async () => {
    stubHealthService({
      getHealth: () => ({
        status: 'ok',
        service: 'school-bus-tracking-api',
        version: 'test',
        uptime: 1,
        timestamp: 't',
        environment: 'test',
      }),
    });

    const response = await invokeRoute(getHealth as EndpointDefinition<never, never>, {
      method: 'GET',
      url: 'http://localhost/api/v1/health',
    });

    assert.equal(response.status, 200);
    // The legacy liveness contract passes the payload through unwrapped (no
    // `success`/`data` envelope) — pinned here so probes keep parsing it.
    assert.equal((response.body as { status: string }).status, 'ok');
  });

  it('answers GET /api/v1/health/ready with 200 when every dependency is ready', async () => {
    stubHealthService({
      getReadiness: async () => ({
        status: 'ready',
        checks: { database: 'ok', sequelize: 'ok', schema: 'ok' },
        timestamp: 't',
      }),
    });

    const response = await invokeRoute(getHealthReady as EndpointDefinition<never, never>, {
      method: 'GET',
      url: 'http://localhost/api/v1/health/ready',
    });

    assert.equal(response.status, 200);
    assert.equal((response.body as { data: { status: string } }).data.status, 'ready');
  });

  it('answers GET /api/v1/health/ready with 503 when a dependency is down', async () => {
    stubHealthService({
      getReadiness: async () => ({
        status: 'not_ready',
        checks: { database: 'fail', sequelize: 'fail', schema: 'fail' },
        // A hostile-shaped reason: raw driver internals must never reach the
        // wire on this unauthenticated endpoint.
        reason: 'connect ECONNREFUSED 10.0.0.5:5432 password=hunter2',
        timestamp: 't',
      }),
    });

    const response = await invokeRoute(getHealthReady as EndpointDefinition<never, never>, {
      method: 'GET',
      url: 'http://localhost/api/v1/health/ready',
    });

    assert.equal(response.status, 503);
    const body = response.body as {
      success: boolean;
      error: { code: string; message: string; details: { checks: Record<string, string> } };
    };
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'SERVICE_NOT_READY');
    assert.equal(body.error.message, 'Service not ready');
    assert.deepEqual(body.error.details, {
      checks: { database: 'fail', sequelize: 'fail', schema: 'fail' },
    });
    assert.ok(
      !JSON.stringify(response.body).includes('10.0.0.5'),
      'raw driver internals must not leak into the public 503 body',
    );
  });
});
