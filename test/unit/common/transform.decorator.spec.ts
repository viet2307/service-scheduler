import { plainToInstance } from 'class-transformer';
import { ToBoolean, Trim } from '@/common/decorators';

class QueryDto {
  @Trim()
  keyword?: unknown;

  @ToBoolean()
  includeCancelled?: unknown;
}

const parse = (plain: object) => plainToInstance(QueryDto, plain);

describe('transform decorators', () => {
  it('trims strings and leaves other values untouched', () => {
    expect(parse({ keyword: '  bay 3 ' }).keyword).toBe('bay 3');
    expect(parse({ keyword: 3 }).keyword).toBe(3);
  });

  it('converts only "true" and "false" to booleans', () => {
    expect(parse({ includeCancelled: 'true' }).includeCancelled).toBe(true);
    expect(parse({ includeCancelled: 'false' }).includeCancelled).toBe(false);
    expect(parse({ includeCancelled: '1' }).includeCancelled).toBe('1');
  });
});
