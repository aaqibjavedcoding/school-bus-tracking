import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import {
  BusDocumentType,
  DocumentStatus,
  DriverDocumentType,
} from '@school-bus-tracking/shared-types';

const BUS_ID = '06060606-0606-4606-8606-060606060601';
const DRIVER_ID = '07070707-0707-4707-8707-070707070701';
const DOCUMENT_ID = '0d0d0d0d-0d0d-40d0-80d0-0d0d0d0d0d01';

const busDocumentBody: { document_type: BusDocumentType; document_number: string } = {
  document_type: BusDocumentType.INSURANCE,
  document_number: 'POL-2026-0091',
};

const driverDocumentBody: { document_type: DriverDocumentType; document_number: string } = {
  document_type: DriverDocumentType.DRIVING_LICENSE,
  document_number: 'DL-0420110012345',
};

describe('ApiClient compliance-document methods', () => {
  it('uses tenant-free bus and driver document endpoints', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });

      await client.createBusDocument(BUS_ID, busDocumentBody);
      await client.listBusDocuments(BUS_ID, { page: 2, limit: 10, status: DocumentStatus.EXPIRED });
      await client.getBusDocumentCompliance(BUS_ID);
      await client.getBusDocument(BUS_ID, DOCUMENT_ID);
      await client.updateBusDocument(BUS_ID, DOCUMENT_ID, { document_number: 'POL-2' });
      await client.deleteBusDocument(BUS_ID, DOCUMENT_ID);

      await client.createDriverDocument(DRIVER_ID, driverDocumentBody);
      await client.listDriverDocuments(DRIVER_ID, { document_type: 'DRIVING_LICENSE' });
      await client.getDriverDocumentCompliance(DRIVER_ID);
      await client.getDriverDocument(DRIVER_ID, DOCUMENT_ID);
      await client.updateDriverDocument(DRIVER_ID, DOCUMENT_ID, { expiry_date: null });
      await client.deleteDriverDocument(DRIVER_ID, DOCUMENT_ID);

      await client.getDocumentOverview({ owner_type: 'BUS', compliance: 'attention' });
      await client.getDocumentRequirements({ owner_type: 'DRIVER' });
      await client.updateDocumentRequirements({
        owner_type: 'BUS',
        items: [{ document_type: 'PERMIT', is_required: false }],
      });

      assert.equal(requests[0].url, `https://api.example.test/api/v1/buses/${BUS_ID}/documents`);
      assert.equal(requests[0].method, 'POST');
      assert.ok(!requests[0].body?.includes('school_id'));
      // A client may never assert a validity status: it is derived from dates.
      assert.ok(!requests[0].body?.includes('"status"'));

      assert.equal(
        requests[1].url,
        `https://api.example.test/api/v1/buses/${BUS_ID}/documents?page=2&limit=10&status=EXPIRED`,
      );
      assert.equal(
        requests[2].url,
        `https://api.example.test/api/v1/buses/${BUS_ID}/documents/compliance`,
      );
      assert.equal(requests[4].method, 'PATCH');
      assert.equal(requests[5].method, 'DELETE');

      assert.equal(
        requests[6].url,
        `https://api.example.test/api/v1/drivers/${DRIVER_ID}/documents`,
      );
      assert.equal(
        requests[7].url,
        `https://api.example.test/api/v1/drivers/${DRIVER_ID}/documents?document_type=DRIVING_LICENSE`,
      );
      assert.equal(
        requests[8].url,
        `https://api.example.test/api/v1/drivers/${DRIVER_ID}/documents/compliance`,
      );
      assert.equal(requests[11].method, 'DELETE');

      assert.equal(
        requests[12].url,
        'https://api.example.test/api/v1/documents/overview?owner_type=BUS&compliance=attention',
      );
      assert.equal(
        requests[13].url,
        'https://api.example.test/api/v1/document-requirements?owner_type=DRIVER',
      );
      assert.equal(requests[14].url, 'https://api.example.test/api/v1/document-requirements');
      assert.equal(requests[14].method, 'PUT');

      // Nothing anywhere in the surface carries a client tenant id.
      assert.ok(requests.every((request) => !request.url.includes('school_id=')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
