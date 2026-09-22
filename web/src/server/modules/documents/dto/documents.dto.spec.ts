import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '../../../framework';
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

  it('requires the document number and both dates', async () => {
    // A type on its own is not a compliance record: without a number and a
    // validity window nothing about the document can ever be verified.
    assert.deepEqual(
      await errorsOf(plainToInstance(CreateBusDocumentDto, { document_type: 'PERMIT' })),
      ['document_number', 'issue_date', 'expiry_date'],
    );
  });

  it('rejects a blank or cleared document number', async () => {
    for (const document_number of ['', '   ', null]) {
      assert.deepEqual(
        await errorsOf(
          plainToInstance(CreateBusDocumentDto, { ...VALID_BUS_DOCUMENT, document_number }),
        ),
        ['document_number'],
        `document_number=${JSON.stringify(document_number)}`,
      );
    }
  });

  it('rejects a cleared issue or expiry date', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, { ...VALID_BUS_DOCUMENT, issue_date: null }),
      ),
      ['issue_date'],
    );
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          document_type: 'REGISTRATION_CERTIFICATE',
          document_number: 'RC-2026-1',
          issue_date: '2026-04-01',
          expiry_date: null,
        }),
      ),
      ['expiry_date'],
    );
  });

  it('requires the expiry date to be strictly after the issue date', async () => {
    for (const expiry_date of ['2026-04-01', '2026-03-31']) {
      assert.deepEqual(
        await errorsOf(
          plainToInstance(CreateBusDocumentDto, { ...VALID_BUS_DOCUMENT, expiry_date }),
        ),
        ['expiry_date'],
        `expiry_date=${expiry_date}`,
      );
    }
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, { ...VALID_BUS_DOCUMENT, expiry_date: '2026-04-02' }),
      ),
      [],
    );
  });

  it('requires a document type', async () => {
    assert.deepEqual(await errorsOf(plainToInstance(CreateBusDocumentDto, {})), [
      'document_type',
      'document_number',
      'issue_date',
      'expiry_date',
    ]);
  });

  it('rejects a document type from the driver catalogue', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          ...VALID_BUS_DOCUMENT,
          document_type: 'DRIVING_LICENSE',
        }),
      ),
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

  it('accepts a full date-time as well as a calendar date', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateBusDocumentDto, {
          ...VALID_BUS_DOCUMENT,
          issue_date: '2026-04-01T00:00:00.000Z',
          expiry_date: '2027-04-01T00:00:00.000Z',
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
      notes: '',
      file_name: '   ',
    });
    assert.deepEqual(await errorsOf(instance), []);
    assert.equal(instance.notes, null);
    assert.equal(instance.file_name, null);
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

  it('accepts corrections to the number and the dates', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(UpdateBusDocumentDto, {
          document_number: 'POL-2026-0092',
          issue_date: '2026-05-01',
          expiry_date: '2027-04-30',
        }),
      ),
      [],
    );
  });

  it('refuses to clear the number or a date — they can only be corrected', async () => {
    for (const patch of [
      { document_number: null },
      { document_number: '   ' },
      { issue_date: null },
      { expiry_date: null },
    ]) {
      const property = Object.keys(patch)[0];
      assert.deepEqual(
        await errorsOf(plainToInstance(UpdateBusDocumentDto, patch)),
        [property],
        JSON.stringify(patch),
      );
    }
  });

  it('still clears notes and the file reference with null', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(UpdateBusDocumentDto, { notes: null, file_url: null })),
      [],
    );
  });

  it('range-checks the two dates against each other when both are supplied', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(UpdateBusDocumentDto, {
          issue_date: '2027-01-01',
          expiry_date: '2027-01-01',
        }),
      ),
      ['expiry_date'],
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

  it('requires the licence number and both dates', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateDriverDocumentDto, {
          document_type: DriverDocumentType.DRIVING_LICENSE,
        }),
      ),
      ['document_number', 'issue_date', 'expiry_date'],
    );
  });

  it('requires them for a conductor too — crew share this resource', async () => {
    // Bus, driver and conductor documents all have to be verifiable; the crew
    // roles (driver *and* conductor) ride the `/drivers/:driverId/documents`
    // resource and therefore the same DTO.
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateDriverDocumentDto, {
          document_type: DriverDocumentType.POLICE_VERIFICATION,
        }),
      ),
      ['document_number', 'issue_date', 'expiry_date'],
    );
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateDriverDocumentDto, {
          document_type: DriverDocumentType.POLICE_VERIFICATION,
          document_number: 'PV-2026-77',
          issue_date: '2026-01-01',
          expiry_date: '2027-01-01',
        }),
      ),
      [],
    );
  });

  it('rejects a bus document type on the driver resource', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateDriverDocumentDto, {
          ...VALID_DRIVER_DOCUMENT,
          document_type: 'INSURANCE',
        }),
      ),
      ['document_type'],
    );
  });

  it('requires the expiry date to be strictly after the issue date', async () => {
    assert.deepEqual(
      await errorsOf(
        plainToInstance(CreateDriverDocumentDto, {
          ...VALID_DRIVER_DOCUMENT,
          expiry_date: '2019-05-01',
        }),
      ),
      ['expiry_date'],
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

  it('refuses a cleared licence number on a conductor as well', async () => {
    assert.deepEqual(
      await errorsOf(plainToInstance(UpdateDriverDocumentDto, { document_number: null })),
      ['document_number'],
    );
  });
});

describe('missing compliance fields produce actionable messages', () => {
  const throughPipe = <T>(metatype: new (...args: never[]) => T, body: object) =>
    strictPipe.transform(body, { metatype, type: 'body', data: '' }).then(
      () => null,
      (thrown: unknown) => thrown as BadRequestException,
    );

  it('names every missing field for a bus document', async () => {
    const error = await throughPipe(CreateBusDocumentDto, {
      document_type: BusDocumentType.INSURANCE,
    });
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    const response = error.getResponse() as {
      message: string[];
      error: string;
      statusCode: number;
    };
    assert.deepEqual(response.message, [
      'Please enter the document number.',
      'Please enter the issue date.',
      'Please enter the expiry date.',
    ]);
    // The envelope is untouched: same error code, same status.
    assert.equal(response.error, 'Bad Request');
    assert.equal(response.statusCode, 400);
  });

  it('names every missing field for a driver document', async () => {
    const error = await throughPipe(CreateDriverDocumentDto, {
      document_type: DriverDocumentType.DRIVING_LICENSE,
    });
    assert.ok(error instanceof BadRequestException);
    const response = error.getResponse() as { message: string[] };
    assert.deepEqual(response.message, [
      'Please enter the document number.',
      'Please enter the issue date.',
      'Please enter the expiry date.',
    ]);
  });

  it('names every missing field for a conductor document', async () => {
    // Conductors share the driver document resource, so the same three
    // messages guard their paperwork.
    const error = await throughPipe(CreateDriverDocumentDto, {
      document_type: DriverDocumentType.POLICE_VERIFICATION,
    });
    assert.ok(error instanceof BadRequestException);
    const response = error.getResponse() as { message: string[] };
    assert.deepEqual(response.message, [
      'Please enter the document number.',
      'Please enter the issue date.',
      'Please enter the expiry date.',
    ]);
  });

  it('explains a bad date and a reversed validity window in plain language', async () => {
    const badDate = await throughPipe(CreateBusDocumentDto, {
      ...VALID_BUS_DOCUMENT,
      expiry_date: '31-03-2027',
    });
    assert.ok(badDate instanceof BadRequestException);
    assert.deepEqual((badDate.getResponse() as { message: string[] }).message, [
      'Please enter the expiry date as a real date (for example 2026-04-01).',
    ]);

    const reversed = await throughPipe(CreateBusDocumentDto, {
      ...VALID_BUS_DOCUMENT,
      issue_date: '2027-01-01',
      expiry_date: '2026-01-01',
    });
    assert.ok(reversed instanceof BadRequestException);
    assert.deepEqual((reversed.getResponse() as { message: string[] }).message, [
      'Please enter an expiry date after the issue date.',
    ]);
  });

  it('lets a complete payload through unchanged', async () => {
    const bus = await strictPipe.transform(VALID_BUS_DOCUMENT, {
      metatype: CreateBusDocumentDto,
      type: 'body',
      data: '',
    });
    assert.deepEqual(bus, plainToInstance(CreateBusDocumentDto, VALID_BUS_DOCUMENT));

    const driver = await strictPipe.transform(VALID_DRIVER_DOCUMENT, {
      metatype: CreateDriverDocumentDto,
      type: 'body',
      data: '',
    });
    assert.deepEqual(driver, plainToInstance(CreateDriverDocumentDto, VALID_DRIVER_DOCUMENT));
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

describe('file_url https-only enforcement', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  const build = () =>
    plainToInstance(CreateBusDocumentDto, {
      ...VALID_BUS_DOCUMENT,
      file_url: 'http://files.example.test/insurance.pdf',
    });

  it('accepts an http file_url in non-production environments', async () => {
    process.env.NODE_ENV = 'development';
    try {
      assert.deepEqual(await errorsOf(build()), []);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('rejects an http file_url in production while keeping https accepted', async () => {
    process.env.NODE_ENV = 'production';
    try {
      assert.deepEqual(await errorsOf(build()), ['file_url']);

      assert.deepEqual(
        await errorsOf(
          plainToInstance(CreateBusDocumentDto, {
            ...VALID_BUS_DOCUMENT,
            file_url: 'https://files.example.test/insurance.pdf',
          }),
        ),
        [],
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
