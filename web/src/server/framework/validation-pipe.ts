/**
 * Faithful reimplementation of `@nestjs/common`'s `ValidationPipe` for the
 * option set this application uses globally:
 *
 *     new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
 *
 * The behaviour that must be preserved exactly, because the HTTP contract and
 * the existing DTO specs depend on it:
 *
 * - `transform: true` returns a real DTO **class instance** (so
 *   `@Type`/`@Transform` coercions and defaults apply).
 * - `whitelist: true` strips properties that carry no validation decorator.
 * - `forbidNonWhitelisted: true` upgrades stripping into a 400 that names the
 *   offending property: `property <name> should not exist`.
 * - Failures throw `BadRequestException` whose response body is
 *   `{ message: string[], error: 'Bad Request', statusCode: 400 }` — note the
 *   **array** message, which `HttpExceptionFilter` forwards verbatim.
 * - Primitive metatypes (String/Boolean/Number/Array/Object) and an absent
 *   metatype are passed through untouched.
 */
import 'reflect-metadata';
import { validate, type ValidationError, type ValidatorOptions } from 'class-validator';
import { plainToInstance, type ClassTransformOptions } from 'class-transformer';
import { BadRequestException } from './http-exception';

/** Mirrors Nest's `ArgumentMetadata`. */
export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom';
  metatype?: new (...args: never[]) => unknown;
  data?: string;
}

export interface ValidationPipeOptions extends ValidatorOptions {
  transform?: boolean;
  transformOptions?: ClassTransformOptions;
  /** Overrides how a set of `ValidationError`s becomes the thrown exception. */
  exceptionFactory?: (errors: ValidationError[]) => unknown;
}

/** Types that are never run through class-validator. */
const PRIMITIVE_TYPES: readonly unknown[] = [String, Boolean, Number, Array, Object];

/**
 * Flattens nested validation errors into the single string array Nest
 * produces, depth-first, preserving Nest's ordering and message text.
 */
export function flattenValidationErrors(errors: ValidationError[]): string[] {
  const messages: string[] = [];

  const walk = (error: ValidationError): void => {
    if (error.constraints) {
      messages.push(...Object.values(error.constraints));
    }
    for (const child of error.children ?? []) {
      walk(child);
    }
  };

  for (const error of errors) {
    walk(error);
  }

  return messages;
}

export class ValidationPipe {
  private readonly options: ValidationPipeOptions;

  constructor(options: ValidationPipeOptions = {}) {
    this.options = options;
  }

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const { metatype } = metadata;

    if (!metatype || PRIMITIVE_TYPES.includes(metatype)) {
      return value;
    }

    const {
      transform = false,
      transformOptions,
      exceptionFactory,
      ...validatorOptions
    } = this.options;

    // `plainToInstance` applies @Type coercion and property defaults; the
    // undefined-value guard matches Nest, which validates an empty object
    // rather than crashing when a body is absent.
    const instance = plainToInstance(metatype, value ?? {}, transformOptions);

    const errors = await validate(instance as object, validatorOptions);

    if (errors.length > 0) {
      if (exceptionFactory) {
        throw exceptionFactory(errors);
      }
      throw new BadRequestException({
        message: flattenValidationErrors(errors),
        error: 'Bad Request',
        statusCode: 400,
      });
    }

    // Without `transform`, Nest hands the original plain value to the handler.
    return transform ? instance : value;
  }
}

/**
 * The single globally configured validation pipe, matching `main.ts`.
 *
 * Shared by every route handler so validation semantics cannot drift between
 * endpoints the way per-route pipe instances could.
 */
export const globalValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

/** Validates a body/query payload against a DTO class, returning the instance. */
export async function validateDto<T>(
  metatype: new (...args: never[]) => T,
  value: unknown,
  type: ArgumentMetadata['type'] = 'body',
): Promise<T> {
  return (await globalValidationPipe.transform(value, { metatype, type })) as T;
}
