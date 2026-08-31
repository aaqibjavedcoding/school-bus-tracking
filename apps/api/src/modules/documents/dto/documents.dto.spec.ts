import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BusDocumentType, DriverDocumentType } from '@school-bus-tracking/shared-types';
import { CreateBusDocumentDto } from './create-bus-document.dto';
import { CreateDriverDocumentDto } from './create-driver-document.dto';
import { UpdateBusDocumentDto } from './update-bus-document.dto';
import { UpdateDriverDocumentDto } from './update-driver-document.dto';
import { ListDocumentsQueryDto } from './list-documents-query.dto';
import { UpdateDocumentRequirementsDto } from './update-document-requirements.dto';
import { DocumentRequirementsQueryDto } from './document-requirements-query.dto';
import { DocumentOverviewQueryDto } from './document-overview-query.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';

const VALID_BUS_DOCUMENT = {
  document_type: BusDocumentType.INSURANCE,
  document_number: 'POL-2026-0091',
  issue_date: '2026-04-01',
  expiry_date: '2027-03-31',
  file_url: 'https://files.example.test/insurance.pdf',
};

const VALID_DRIVER_DOCUMENT = {
  document_type: DriverDocumentType.DRIVING_LICENSE,
  document_number: 'DL-0420110012345',
  issue_date: '2019-05-01',
  expiry_date: '2029-04-30',
};

const strictPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

async function errorsOf(dto: object): Promise<string[]> {
  return (await validate(dto)).map((error) => error.property);
}

describe('CreateBusDocumentDto validation', () => {
  it('accepts a well-formed document', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(CreateBusDocumentDto, VALID_BUS_DOCUMENT)), []);
  });

  it('accepts a document with only its type', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(CreateBusDocumentDto, { document_type: 'PERMIT' })),
      [],
    );
  });

  it('requires a document type', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(CreateBusDocumentDto, {})), ['document_type']);
  });

  it('rejects a document type from the driver catalogue', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(CreateBusDocumentDto, { document_type: 'DRIVING_LICENSE' })),
      ['document_type'],
    );
  });

  it('rejects a malformed or impossible date', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          ...VALID_BUS_DOCUMENT,
          expiry_date: '31-03-2027',
        }),
      ),
      ['expiry_date'],
    );
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          ...VALID_BUS_DOCUMENT,
          issue_date: '2026-02-31',
        }),
      ),
      ['issue_date'],
    );
  });

  it('accepts a document with no expiry date at all', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          document_type: 'REGISTRATION_CERTIFICATE',
          expiry_date: null,
        }),
      ),
      [],
    );
  });

  it('rejects a non http(s) file reference', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          ...VALID_BUS_DOCUMENT,
          file_url: 'javascript:alert(1)',
        }),
      ),
      ['file_url'],
    );
  });

  it('normalizes blank optional text to null', async () => {
    const instance = plainToInstance(CreateBusDocumentDto, {
      ...VALID_BUS_DOCUMENT,
      document_number: '   ',
      notes: '',
    });
    assert.deepEqual(await errorsOf(instance), []);
    assert.equal(instance.document_number, null);
    assert.equal(instance.notes, null);
  });

  it('rejects a school_id, a bus_id and a status supplied by the client', async () => {
    for (const injected of [
      { school_id: SCHOOL_ID },
      { bus_id: '22222222-2222-4222-8222-222222222222' },
      { status: 'VALID' },
      { owner: 'something-else' },
    ]) {
      await assert.rejects(
        strictPipe.transform(
          { ...VALID_BUS_DOCUMENT, ...injected },
          { metatype: CreateBusDocumentDto, type: 'body', data: '' },
        ),
        (error: { getStatus?: () => number }) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus?.(), 400);
          return true;
        },
      );
    }
  });
});

describe('UpdateBusDocumentDto validation', () => {
  it('accepts an empty partial update', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(UpdateBusDocumentDto, {})), []);
  });

  it('accepts a single field update and clearing', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(UpdateBusDocumentDto, { expiry_date: null })),
      [],
    );
  });

  it('rejects an invalid partial field', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(UpdateBusDocumentDto, { notes: 42 })), [
      'notes',
    ]);
  });
});

describe('CreateDriverDocumentDto / UpdateDriverDocumentDto validation', () => {
  it('accepts a driving licence with its licence number', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(CreateDriverDocumentDto, VALID_DRIVER_DOCUMENT)),
      [],
    );
  });

  it('rejects a bus document type on the driver resource', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(CreateDriverDocumentDto, { document_type: 'INSURANCE' })),
      ['document_type'],
    );
  });

  it('rejects a driver_id supplied by the client', async () => {
    await assert.rejects(
      strictPipe.transform(
        { ...VALID_DRIVER_DOCUMENT, driver_id: '22222222-2222-4222-8222-222222222222' },
        { metatype: CreateDriverDocumentDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });

  it('accepts an empty driver document update', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(UpdateDriverDocumentDto, {})), []);
  });
});

describe('ListDocumentsQueryDto validation', () => {
  it('applies pagination defaults', async () => {
    const instance = plainToInstance(ListDocumentsQueryDto, {});
    assert.deepEqual(await errorsOf(instance), []);
    assert.equal(instance.page, 1);
    assert.equal(instance.limit, 20);
  });

  it('accepts the derived status filter', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(ListDocumentsQueryDto, { status: 'EXPIRING_SOON' })),
      [],
    );
  });

  it('rejects a stored-looking status such as MISSING', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(ListDocumentsQueryDto, { status: 'MISSING' })),
      ['status'],
    );
  });

  it('rejects out-of-range pagination', async () => {
    assert.deepEqual(
      (await errorsOf(plainToInstance(ListDocumentsQueryDto, { page: 0, limit: 500 }))).sort(),
      ['limit', 'page'],
    );
  });
});

describe('UpdateDocumentRequirementsDto validation', () => {
  const VALID = {
    owner_type: 'BUS',
    items: [{ document_type: 'INSURANCE', is_required: true, expiry_warning_days: 60 }],
  };

  it('accepts a requirement override set', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(UpdateDocumentRequirementsDto, VALID)), []);
  });

  it('requires the owner type and at least one item', async () => {
    assert.deepEqual(
      (
        await errorsOf(plainToInstance(UpdateDocumentRequirementsDto, { items: VALID.items }))
      ).sort(),
      ['owner_type'],
    );
    assert.deepEqual(
      (
        await errorsOf(
          plainToInstance(UpdateDocumentRequirementsDto, { owner_type: 'BUS', items: [] }),
        )
      ).sort(),
      ['items'],
    );
  });

  it('validates nested items', async () => {
    const errors = await validate(
      plainToInstance(UpdateDocumentRequirementsDto, {
        owner_type: 'DRIVER',
        items: [{ document_type: '', is_required: 'yes', expiry_warning_days: 0 }],
      }),
    );
    assert.deepEqual(errors.map((error) => error.property).sort(), ['items']);
  });

  it('rejects a school_id supplied by the client', async () => {
    await assert.rejects(
      strictPipe.transform(
        { ...VALID, school_id: SCHOOL_ID },
        { metatype: UpdateDocumentRequirementsDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('DocumentRequirementsQueryDto / DocumentOverviewQueryDto validation', () => {
  it('requires an owner type on the requirements query', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(DocumentRequirementsQueryDto, {})), [
      'owner_type',
    ]);
    assert.deepEqual(
      await errorsOf(plainToInstance(DocumentRequirementsQueryDto, { owner_type: 'DRIVER' })),
      [],
    );
  });

  it('accepts and rejects the overview filters', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(DocumentOverviewQueryDto, { owner_type: 'BUS', compliance: 'attention' }),
      ),
      [],
    );
    assert.deepEqual(
      await errorsOf(plainToInstance(DocumentOverviewQueryDto, { compliance: 'all' })),
      ['compliance'],
    );
  });
});
