import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Response } from 'supertest';
import { parse } from 'yaml';

interface MediaType {
  schema?: object;
}

interface Operation {
  operationId?: string;
  responses: Record<string, { content?: Record<string, MediaType> }>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, object> };
}

// The committed file, not the live document: the test fails until `npm run openapi:generate` is run and reviewed.
const document = parse(
  readFileSync(resolve(__dirname, '..', '..', '..', 'openapi.yaml'), 'utf8'),
) as OpenApiDocument;

const operations = new Map(
  Object.values(document.paths)
    .flatMap((methods) => Object.values(methods))
    .filter((operation) => operation.operationId)
    .map((operation) => [operation.operationId!, operation]),
);

const SCHEMA_ID = 'openapi';

/** Points `#/components/schemas/X` at the registered copy of the components. */
const rewriteRefs = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === '$ref' && typeof value === 'string'
        ? value.replace('#/components/schemas/', `${SCHEMA_ID}#/$defs/`)
        : rewriteRefs(value),
    ]),
  );
};

// strict: false ignores OpenAPI-only keywords such as `example`; Ajv understands OAS 3.0 `nullable`.
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({
  $id: SCHEMA_ID,
  $defs: rewriteRefs(document.components?.schemas ?? {}),
});

const validators = new Map<string, ValidateFunction>();

function validatorFor(
  operationId: string,
  status: number,
  mediaType: string,
): ValidateFunction {
  const key = `${operationId} ${status} ${mediaType}`;
  const cached = validators.get(key);
  if (cached) return cached;

  const operation = operations.get(operationId);
  if (!operation)
    throw new Error(`openapi.yaml has no operation ${operationId}`);
  const schema =
    operation.responses[String(status)]?.content?.[mediaType]?.schema;
  if (!schema)
    throw new Error(`openapi.yaml does not document ${key} with a schema`);

  const validate = ajv.compile(rewriteRefs(schema) as object);
  validators.set(key, validate);
  return validate;
}

/** Fails when the response status, media type or body is not what openapi.yaml documents for the operation. */
export function expectMatchesOpenApi(res: Response, operationId: string): void {
  const validate = validatorFor(operationId, res.status, res.type);
  if (!validate(res.body)) {
    throw new Error(
      `Response does not match openapi.yaml (${operationId} ${res.status}): ${ajv.errorsText(validate.errors)}`,
    );
  }
}
