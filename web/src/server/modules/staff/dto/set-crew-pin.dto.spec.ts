import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { crewPinSetSchema } from '@school-bus-tracking/validation';
import { globalValidationPipe, BadRequestException } from '../../../framework';
import { SetCrewPinDto } from './set-crew-pin.dto';

async function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(SetCrewPinDto, body));
}

function properties(errors: Awaited<ReturnType<typeof errorsFor>>): string[] {
  return errors.map((error) => error.property).sort();
}

/** Runs the body through the pipe exactly as `createRouteHandler` does. */
async function throughPipe(body: Record<string, unknown>): Promise<SetCrewPinDto> {
  return (await globalValidationPipe.transform(body, {
    metatype: SetCrewPinDto as never,
    type: 'body',
  })) as SetCrewPinDto;
}

describe('SetCrewPinDto validation', () => {
  it('accepts a four-digit PIN', async () => {
    assert.deepEqual(properties(await errorsFor({ pin: '4821' })), []);
  });

  it('accepts 0000 — the whole four-digit space is issuable', async () => {
    assert.deepEqual(properties(await errorsFor({ pin: '0000' })), []);
  });

  /**
   * The load-bearing case.
   *
   * `pin: null` means "clear this PIN", and the global pipe runs with
   * `whitelist: true`, which strips properties it considers unvalidated. A
   * silently stripped `null` would arrive at `CrewAuthService.setPin()` as
   * `undefined` — and `hashPassword(undefined)` would then *set* a PIN derived
   * from the string "undefined" instead of clearing one. So this is asserted
   * through the real pipe, not just through `validate()`.
   */
  it('survives the whitelist pipe as a genuine null, not undefined', async () => {
    const dto = await throughPipe({ pin: null });
    assert.equal(dto.pin, null);
    assert.ok('pin' in dto, 'the property must not be stripped by whitelist:true');
    assert.notEqual(dto.pin, undefined);
  });

  it('rejects an absent pin — clearing must be explicit', async () => {
    const errors = await errorsFor({});
    assert.deepEqual(properties(errors), ['pin']);
    await assert.rejects(() => throughPipe({}), BadRequestException);
  });

  it('rejects a PIN that is not exactly four digits', async () => {
    for (const pin of ['123', '12345', 'abcd', '12a4', ' 1234', '1234 ', '', '१२३४']) {
      assert.deepEqual(properties(await errorsFor({ pin })), ['pin'], `pin="${pin}"`);
    }
  });

  it('rejects a numeric PIN rather than coercing it', async () => {
    // `1234` the number is not `01234` truncated and not `"1234"` — a client
    // that sent a number has already lost any leading zero, so it must fail.
    assert.deepEqual(properties(await errorsFor({ pin: 1234 })), ['pin']);
  });

  it('rejects unknown fields', async () => {
    // `forbidNonWhitelisted` is a pipe option, not a `validate()` one — this
    // goes through the same pipe `createRouteHandler` uses.
    for (const body of [{ pin: '4821', password: 'x' }, { pin: '4821', user_id: 'y' }]) {
      await assert.rejects(() => throughPipe(body), BadRequestException, JSON.stringify(body));
    }
  });

  it('never echoes the submitted PIN back in an error message', async () => {
    const errors = await errorsFor({ pin: '99999999' });
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    assert.ok(messages.length > 0);
    for (const message of messages) {
      assert.ok(!message.includes('99999999'), `message leaked the PIN: ${message}`);
    }
  });
});

describe('SetCrewPinDto ↔ shared crewPinSetSchema agreement', () => {
  it('accepts exactly the same bodies', async () => {
    const bodies: Array<Record<string, unknown>> = [
      { pin: '4821' },
      { pin: '0000' },
      { pin: null },
      {},
      { pin: '123' },
      { pin: '12345' },
      { pin: 4821 },
      { pin: '' },
    ];
    for (const body of bodies) {
      const dtoAccepted = (await errorsFor(body)).length === 0;
      const schemaAccepted = crewPinSetSchema.safeParse(body).success;
      assert.equal(
        dtoAccepted,
        schemaAccepted,
        `DTO and shared schema disagree on ${JSON.stringify(body)}`,
      );
    }
  });

  it('both layers reject an unknown field', async () => {
    const body = { pin: '4821', extra: true };
    await assert.rejects(() => throughPipe(body), BadRequestException);
    assert.equal(crewPinSetSchema.safeParse(body).success, false);
  });

  it('the pipe output of an accepted body re-validates against the shared schema', async () => {
    for (const body of [{ pin: '4821' }, { pin: null }]) {
      const dto = await throughPipe(body);
      assert.equal(crewPinSetSchema.safeParse({ pin: dto.pin }).success, true);
    }
  });
});
