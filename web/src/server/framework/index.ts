/**
 * The framework layer: plain-TypeScript replacements for the `@nestjs/*`
 * primitives this codebase used to depend on.
 *
 * Application code imports from here instead of `@nestjs/common`,
 * `@nestjs/config` and `@nestjs/jwt`. Every export preserves the observable
 * behaviour of its Nest counterpart, so the HTTP contract (status codes,
 * error envelopes, validation messages) is unchanged.
 */
export {
  HttpStatus,
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  InternalServerErrorException,
  ServiceUnavailableException,
  type HttpExceptionBody,
} from './http-exception';

export { Logger } from './logger';

export { ConfigService, registerAs, type ConfigFactory } from './config';

export { JwtService, type JwtModuleOptions } from './jwt';

export {
  ValidationPipe,
  globalValidationPipe,
  validateDto,
  flattenValidationErrors,
  type ArgumentMetadata,
  type ValidationPipeOptions,
} from './validation-pipe';

export {
  ParseUUIDPipe,
  parseUuidParam,
  isUuid,
  UUID_VALIDATION_FAILED_MESSAGE,
  type UUIDVersion,
  type ParseUUIDPipeOptions,
} from './parse-uuid-pipe';

export {
  Reflector,
  SetMetadata,
  createExecutionContext,
  type ExecutionContext,
  type ArgumentsHost,
  type HttpArgumentsHost,
  type CanActivate,
  type CallHandler,
  type NestInterceptor,
  type PipeTransform,
  type ExceptionFilter,
  type Type,
} from './execution-context';
