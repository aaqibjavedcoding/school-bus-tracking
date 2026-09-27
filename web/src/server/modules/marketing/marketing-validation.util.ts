import { BadRequestException } from '../../framework';
import { ZodError } from 'zod';

/**
 * Converts a ZodError into a BadRequest with field-keyed `details` — the
 * admin-plans convention, shared by the marketing services so every deep
 * validation failure returns the same error shape.
 */
export function marketingValidationException(error: ZodError): BadRequestException {
  const details: Record<string, string> = {};
  const formMessages: string[] = [];
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      formMessages.push(issue.message);
      continue;
    }
    const key = issue.path.join('.');
    if (!details[key]) {
      details[key] = issue.message;
    }
  }
  return new BadRequestException({
    message:
      formMessages.length > 0
        ? formMessages.join(' ')
        : 'Please check the submitted fields and try again.',
    details,
  });
}

/** Parses with a zod schema or throws the shared BadRequest shape. */
export function parseOrThrow<T>(schema: { parse: (input: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw marketingValidationException(error);
    }
    throw error;
  }
}
