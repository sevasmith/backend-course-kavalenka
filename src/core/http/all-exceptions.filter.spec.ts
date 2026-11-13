import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

import { RbacManageInvariantError } from '@/modules/rbac/rbac-policy-change.service';
import { RbacPolicyUnavailableError } from '@/modules/rbac/rbac-policy-snapshot.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { apiError, ErrorCode } from './api-error';

describe('AllExceptionsFilter', () => {
  const response = { kind: 'reply' };
  const reply = jest.fn();
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  let filter: AllExceptionsFilter;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    reply.mockReset();
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    filter = new AllExceptionsFilter({
      httpAdapter: { reply },
    } as unknown as HttpAdapterHost);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Runs the filter and returns the body and status it replied with. */
  const handle = (exception: unknown) => {
    filter.catch(exception, host);
    expect(reply).toHaveBeenCalledTimes(1);
    const [target, body, status] = reply.mock.calls[0] as [
      unknown,
      { statusCode: number },
      number,
    ];
    expect(target).toBe(response);
    expect(status).toBe(body.statusCode);
    return body;
  };

  it.each([
    [new BadRequestException('Bad'), 400, ErrorCode.BAD_REQUEST],
    [new UnauthorizedException(), 401, ErrorCode.INVALID_SESSION],
    [new ForbiddenException(), 403, ErrorCode.PERMISSION_DENIED],
    [new NotFoundException('Role not found'), 404, ErrorCode.NOT_FOUND],
    [new HttpException('Too soon', 429), 429, ErrorCode.RATE_LIMIT_EXCEEDED],
  ])('maps %p to its default code', (exception, statusCode, code) => {
    expect(handle(exception)).toEqual({
      statusCode,
      code,
      message: exception.message,
    });
  });

  it('keeps the validation messages as an array', () => {
    const exception = new BadRequestException(['name must be a string']);

    expect(handle(exception)).toEqual({
      statusCode: 400,
      code: ErrorCode.BAD_REQUEST,
      message: ['name must be a string'],
    });
  });

  it('uses the code chosen with apiError()', () => {
    const exception = new ForbiddenException(
      apiError(ErrorCode.CSRF_REJECTED, 'CSRF check failed'),
    );

    expect(handle(exception)).toEqual({
      statusCode: 403,
      code: ErrorCode.CSRF_REJECTED,
      message: 'CSRF check failed',
    });
  });

  it('maps a lost rbac@manage to 409 conflict', () => {
    expect(handle(new RbacManageInvariantError())).toMatchObject({
      statusCode: 409,
      code: ErrorCode.CONFLICT,
    });
  });

  it('maps an unavailable policy to 503 authorization_unavailable with a neutral message', () => {
    expect(
      handle(new RbacPolicyUnavailableError({ cause: new Error('db down') })),
    ).toEqual({
      statusCode: 503,
      code: ErrorCode.AUTHORIZATION_UNAVAILABLE,
      message: 'Authorization is temporarily unavailable',
    });
  });

  it('hides the message of other 5xx exceptions', () => {
    expect(
      handle(new ServiceUnavailableException('SMTP host smtp.local refused')),
    ).toEqual({
      statusCode: 503,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Service is temporarily unavailable',
    });
  });

  it('maps an unhandled unique violation to 409 conflict', () => {
    const error = new QueryFailedError('INSERT ...', [], {
      code: '23505',
    } as unknown as Error);

    expect(handle(error)).toEqual({
      statusCode: 409,
      code: ErrorCode.CONFLICT,
      message: 'The resource already exists',
    });
  });

  it('answers any other error with a neutral 500 and logs it', () => {
    const body = handle(new Error('secret connection string'));

    expect(body).toEqual({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
    expect(logError).toHaveBeenCalledWith(
      'Unhandled error, name=Error',
      expect.any(String),
    );
  });
});
