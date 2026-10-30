import type { Response } from 'supertest';
import { expectMatchesOpenApi } from './support/openapi';

const response = (status: number, type: string, body: unknown) =>
  ({ status, type, body }) as Response;

describe('expectMatchesOpenApi', () => {
  const serviceType = {
    id: '01a16194-0000-7000-8000-0000000000a1',
    code: 'OIL_SERVICE',
    name: 'Oil service',
    durationMinutes: 60,
    requiredSkill: 'GENERAL',
    requiredBayType: 'LIFT',
  };

  it('accepts a body that matches the documented schema', () => {
    expect(() =>
      expectMatchesOpenApi(
        response(200, 'application/json', [serviceType]),
        'ServiceTypes_list',
      ),
    ).not.toThrow();
  });

  it('rejects a missing required property or a wrong type', () => {
    const { code: _code, ...withoutCode } = serviceType;
    expect(() =>
      expectMatchesOpenApi(
        response(200, 'application/json', [withoutCode]),
        'ServiceTypes_list',
      ),
    ).toThrow(/must have required property 'code'/);
    expect(() =>
      expectMatchesOpenApi(
        response(200, 'application/json', [
          { ...serviceType, durationMinutes: 1.5 },
        ]),
        'ServiceTypes_list',
      ),
    ).toThrow(/must be integer/);
  });

  it('rejects undocumented operations, statuses and media types', () => {
    expect(() =>
      expectMatchesOpenApi(response(200, 'application/json', []), 'Nope_list'),
    ).toThrow(/no operation Nope_list/);
    expect(() =>
      expectMatchesOpenApi(
        response(418, 'application/json', []),
        'ServiceTypes_list',
      ),
    ).toThrow(/does not document/);
    expect(() =>
      expectMatchesOpenApi(response(200, 'text/html', ''), 'ServiceTypes_list'),
    ).toThrow(/does not document/);
  });

  it('resolves problem+json responses through component references', () => {
    expect(() =>
      expectMatchesOpenApi(
        response(400, 'application/problem+json', { status: 400 }),
        'ServiceTypes_list',
      ),
    ).toThrow(/must have required property 'type'/);
  });
});
