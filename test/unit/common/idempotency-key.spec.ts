import { extractIdempotencyKey } from '@/common/decorators';
import { AppError, ErrorCode } from '@/common/errors';

const request = (value?: string) => ({
  header: (name: string) => (name === 'Idempotency-Key' ? value : undefined),
});

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as AppError).code;
  }
};

describe('extractIdempotencyKey', () => {
  it('returns the trimmed key', () => {
    expect(extractIdempotencyKey(request(' 0b9f3c2e-7a51-4d7e '))).toBe(
      '0b9f3c2e-7a51-4d7e',
    );
  });

  it.each([undefined, '', '   '])('requires the header (%p)', (value) => {
    expect(codeOf(() => extractIdempotencyKey(request(value)))).toBe(
      ErrorCode.IDEMPOTENCY_KEY_MISSING,
    );
  });

  it.each(['a'.repeat(256), 'has space', 'ünïcode'])(
    'rejects malformed keys (%p)',
    (value) => {
      expect(codeOf(() => extractIdempotencyKey(request(value)))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
    },
  );
});
