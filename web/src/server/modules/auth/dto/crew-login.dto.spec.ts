import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CREW_PIN_COMBINATIONS,
  CREW_PIN_LENGTH,
  crewPinLoginSchema,
  crewPinSetSchema,
} from '@school-bus-tracking/validation';
import { BadRequestException, globalValidationPipe } from '../../../framework';
import { CrewLoginDto, narrowCrewLoginDto } from './crew-login.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';

/**
 * The PIN branch is two fields and a discriminator. There is deliberately no
 * `user_id` — the server resolves which crew member the PIN belongs to — and
 * the assertions below pin that absence as hard as they pin the presence of
 * the fields that remain.
 */
const PIN_BODY = { method: 'pin', school_id: SCHOOL_ID, pin: '4821' };
const QR_BODY = { method: 'qr', pairing_token: 'a'.repeat(64) };

async function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(CrewLoginDto, body));
}

function properties(errors: Awaited<ReturnType<typeof errorsFor>>): string[] {
  return errors.map((error) => error.property).sort();
}

/** Runs the body through the pipe exactly as `createRouteHandler` does. */
async function throughPipe(body: Record<string, unknown>): Promise<CrewLoginDto> {
  return (await globalValidationPipe.transform(body, {
    metatype: CrewLoginDto as never,
    type: 'body',
  })) as CrewLoginDto;
}

describe('CrewLoginDto validation', () => {
  it('accepts a well-formed PIN body', async () => {
    assert.deepEqual(properties(await errorsFor(PIN_BODY)), []);
  });

  it('accepts a school tenant code as school_id on the PIN branch', async () => {
    assert.deepEqual(
      properties(await errorsFor({ ...PIN_BODY, school_id: 'lincoln-high' })),
      [],
    );
  });

  it('accepts a well-formed QR body', async () => {
    assert.deepEqual(properties(await errorsFor(QR_BODY)), []);
  });

  it('requires a method and accepts only the two published values', async () => {
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, method: undefined })), ['method']);
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, method: 'password' })), ['method']);
  });

  it('requires exactly four digits — no more, no fewer, no letters', async () => {
    for (const pin of ['123', '12345', 'abcd', '12a4', ' 1234', '1234 ', '', '१२३४']) {
      assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, pin })), ['pin'], `pin="${pin}"`);
    }
    // The whole 4-digit space is accepted: 0000 is a PIN a driver may be issued.
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, pin: '0000' })), []);
    assert.equal(CREW_PIN_LENGTH, 4);
    assert.equal(CREW_PIN_COMBINATIONS, 10_000);
  });

  it('rejects a non-string PIN rather than coercing it', async () => {
    // `4821` the number must not be silently stringified into a valid PIN: a
    // client that lost the leading zero of `0821` should fail loudly, not log in
    // as somebody else's PIN.
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, pin: 4821 })), ['pin']);
  });

  it('requires the school and refuses a malformed one', async () => {
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, school_id: undefined })), [
      'school_id',
    ]);
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, school_id: 'not a code!' })), [
      'school_id',
    ]);
    assert.deepEqual(properties(await errorsFor({ ...PIN_BODY, school_id: '' })), ['school_id']);
  });

  it('has no user_id field at all — a stale client cannot smuggle one in', async () => {
    // Two halves of the same guarantee. The DTO does not declare the property,
    // so `forbidNonWhitelisted` turns a body carrying one into a 400 that names
    // it; and the narrowed result never gains one, so nothing downstream can
    // read an identity the client claimed.
    await assert.rejects(
      () => throughPipe({ ...PIN_BODY, user_id: '22222222-2222-4222-8222-222222222222' }),
      (error: unknown) => {
        const response = (error as BadRequestException).getResponse() as { message: string[] };
        assert.deepEqual(response.message, ['property user_id should not exist']);
        return true;
      },
    );
    const narrowed = narrowCrewLoginDto(await throughPipe(PIN_BODY)) as unknown as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(narrowed).sort(), ['method', 'pin', 'school_id']);
  });

  it('does not require the PIN-branch fields on the QR branch', async () => {
    assert.deepEqual(properties(await errorsFor(QR_BODY)), []);
  });

  it('requires a pairing token and bounds its length', async () => {
    assert.deepEqual(properties(await errorsFor({ method: 'qr' })), ['pairing_token']);
    assert.deepEqual(properties(await errorsFor({ method: 'qr', pairing_token: '' })), [
      'pairing_token',
    ]);
    // A scanned string of arbitrary length (a URL, a document barcode) must not
    // reach a database lookup.
    assert.deepEqual(properties(await errorsFor({ method: 'qr', pairing_token: 'b'.repeat(513) })), [
      'pairing_token',
    ]);
    assert.deepEqual(properties(await errorsFor({ method: 'qr', pairing_token: 'b'.repeat(512) })), []);
  });

  it('rejects unknown fields, as every DTO in this API does', async () => {
    // `forbidNonWhitelisted` is a *pipe* option, not a `validate()` one, so this
    // has to go through the same pipe the route runtime uses.
    const error = await throughPipe({ ...PIN_BODY, password: 'hunter2', role: 'DRIVER' }).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof BadRequestException, 'unknown fields must be a 400');
    const response = error.getResponse() as { message: string[] };
    assert.deepEqual(response.message.sort(), [
      'property password should not exist',
      'property role should not exist',
    ]);
  });

  it('never echoes the submitted PIN back in an error message', async () => {
    const errors = await errorsFor({ ...PIN_BODY, pin: '99999999' });
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    assert.ok(messages.length > 0);
    for (const message of messages) {
      assert.ok(!message.includes('99999999'), `message leaked the PIN: ${message}`);
    }
  });
});

describe('narrowCrewLoginDto — the compile-time link to the shared contract', () => {
  it('narrows a PIN body onto the shared union', async () => {
    const dto = await throughPipe(PIN_BODY);
    assert.deepEqual(narrowCrewLoginDto(dto), {
      method: 'pin',
      school_id: SCHOOL_ID,
      pin: '4821',
    });
  });

  it('narrows a QR body onto the shared union', async () => {
    const dto = await throughPipe(QR_BODY);
    assert.deepEqual(narrowCrewLoginDto(dto), { method: 'qr', pairing_token: QR_BODY.pairing_token });
  });

  it('tolerates the undefined keys plainToInstance adds for every declared field', async () => {
    // class-transformer's `exposeUnsetFields` defaults to true, so a piped DTO
    // instance carries ALL four declared properties as own keys — the other
    // branch's field included, set to `undefined`. `crewPinLoginSchema` is
    // `.strict()`, so handing it the instance directly rejects every valid
    // login. This pins the workaround: narrow must survive that shape.
    const dto = await throughPipe(PIN_BODY);
    assert.deepEqual(
      Object.keys(dto).sort(),
      ['method', 'pairing_token', 'pin', 'school_id'],
      'precondition: the pipe exposes unset fields',
    );
    assert.equal(dto.pairing_token, undefined);
    assert.equal(
      crewPinLoginSchema.safeParse(dto).success,
      false,
      'the raw instance is genuinely rejected — the filter is load-bearing, not decorative',
    );
    assert.deepEqual(narrowCrewLoginDto(dto), crewPinLoginSchema.parse(PIN_BODY));
  });

  it('keeps a field the client actually sent, including one sent as null', async () => {
    // The flip side of dropping `undefined`: a value the client *did* send must
    // still reach the strict schema, or the mixed-branch check above is hollow.
    const withNull = await throughPipe({ ...QR_BODY, pin: null });
    assert.equal('pin' in withNull, true);
    assert.equal(narrowCrewLoginDto(withNull), null, 'null is a sent value, not an absent one');
  });

  it('returns null for a body whose fields do not match its declared method', async () => {
    // class-validator's @ValidateIf can only make a field required-or-optional
    // per branch; it cannot forbid the other branch's fields. That gap is why
    // this narrowing step and the strict zod parse below both exist.
    const dto = await throughPipe({ ...QR_BODY, pin: '1234' });
    assert.equal(narrowCrewLoginDto(dto), null);
  });
});

/**
 * The two validation layers, pinned against each other.
 *
 * The route runs `CrewLoginDto` (class-validator, the repository's standard 400
 * envelope) and `CrewAuthService` then re-parses with `crewPinLoginSchema` (the
 * `.strict()` shared contract the mobile client validated before sending). Two
 * layers only earn their keep if they agree on what a *valid* body is — otherwise
 * a client that is correct against the published schema gets a 400 from the
 * server, which is the worst possible failure mode for a shared contract.
 */
describe('DTO ↔ shared crewPinLoginSchema agreement', () => {
  const validBodies: Array<Record<string, unknown>> = [
    PIN_BODY,
    { ...PIN_BODY, school_id: 'lincoln-high' },
    { ...PIN_BODY, pin: '0000' },
    QR_BODY,
  ];

  it('every body the shared schema accepts is accepted by the DTO', async () => {
    for (const body of validBodies) {
      const parsed = crewPinLoginSchema.safeParse(body);
      assert.ok(parsed.success, `fixture must be schema-valid: ${JSON.stringify(body)}`);
      assert.deepEqual(
        properties(await errorsFor(body)),
        [],
        `the DTO must accept what the contract accepts: ${JSON.stringify(body)}`,
      );
      // …and the narrowing must reproduce the schema's own output, field for
      // field. This is the assertion that stops the two layers from drifting.
      assert.deepEqual(narrowCrewLoginDto(await throughPipe(body)), parsed.data);
    }
  });

  it('every body the DTO rejects is also rejected by the shared schema', async () => {
    const invalidBodies: Array<Record<string, unknown>> = [
      { ...PIN_BODY, pin: '123' },
      { ...PIN_BODY, pin: 4821 },
      { ...PIN_BODY, school_id: 'not a code!' },
      { ...PIN_BODY, method: 'password' },
      { method: 'qr', pairing_token: '' },
    ];
    for (const body of invalidBodies) {
      assert.ok(
        (await errorsFor(body)).length > 0,
        `the DTO should reject: ${JSON.stringify(body)}`,
      );
      assert.equal(
        crewPinLoginSchema.safeParse(body).success,
        false,
        `the shared schema must reject it too: ${JSON.stringify(body)}`,
      );
    }
  });

  it('both layers reject an unknown field', async () => {
    const body = { ...PIN_BODY, extra: true };
    await assert.rejects(() => throughPipe(body), BadRequestException);
    assert.equal(crewPinLoginSchema.safeParse(body).success, false);
  });

  it('both layers reject a retired user_id, which is now just an unknown field', async () => {
    // The retired field is checked through the *pipe* rather than in the
    // `invalidBodies` list above: bare `validate()` silently strips properties
    // the DTO does not declare, so only the pipe's `forbidNonWhitelisted` sees
    // it — the same mechanism that catches any other unknown key. The strict
    // shared schema refuses it independently, so an older mobile build gets a
    // clean 400 rather than a confusing credential failure.
    const body = { ...PIN_BODY, user_id: '22222222-2222-4222-8222-222222222222' };
    await assert.rejects(() => throughPipe(body), BadRequestException);
    assert.equal(crewPinLoginSchema.safeParse(body).success, false);
  });

  it('the strict schema closes the gap the DTO cannot: cross-branch fields', async () => {
    const mixed = { ...QR_BODY, pin: '1234' };
    // The DTO lets this through (documented above)…
    assert.deepEqual(properties(await errorsFor(mixed)), []);
    // …and the shared `.strict()` schema refuses it, which is what makes the
    // second layer load-bearing rather than decorative.
    assert.equal(crewPinLoginSchema.safeParse(mixed).success, false);
    assert.equal(narrowCrewLoginDto(await throughPipe(mixed)), null);
  });

  it('the shared schema rejects a PIN body with no method discriminator', () => {
    const { method: _method, ...withoutMethod } = PIN_BODY;
    assert.equal(crewPinLoginSchema.safeParse(withoutMethod).success, false);
  });
});

describe('crewPinSetSchema (admin PIN set/reset)', () => {
  it('accepts a four-digit PIN and an explicit null', () => {
    assert.equal(crewPinSetSchema.safeParse({ pin: '4821' }).success, true);
    assert.equal(crewPinSetSchema.safeParse({ pin: null }).success, true);
  });

  it('rejects everything else, including undefined', () => {
    for (const body of [{}, { pin: '123' }, { pin: '12345' }, { pin: 4821 }, { pin: '' }]) {
      assert.equal(crewPinSetSchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });

  it('is strict, so an unknown field cannot ride along', () => {
    assert.equal(crewPinSetSchema.safeParse({ pin: '4821', password: 'x' }).success, false);
  });
});
