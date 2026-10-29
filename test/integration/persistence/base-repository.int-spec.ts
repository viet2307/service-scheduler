import { Generated, Kysely, sql } from 'kysely';
import { AppError, ErrorCode } from '@/common/errors';
import type { PageRequest } from '@/common/dto';
import { BaseRepository } from '@/persistence/base.repository';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { TransactionHost } from '@/persistence/transaction-host';
import { createTestDatabase } from '../../support/database';

interface ServiceBayTable {
  id: Generated<string>;
  bayName: string;
  createdAt: Generated<Date>;
}

declare module '@/persistence/database.types' {
  interface DB {
    service_bay_fixture: ServiceBayTable;
  }
}

class BayRepository extends BaseRepository<'service_bay_fixture'> {
  protected readonly table = 'service_bay_fixture';

  listByName(page: PageRequest) {
    return this.paginate(
      this.db.selectFrom('service_bay_fixture').selectAll().orderBy('bayName'),
      page,
    );
  }
}

describe('BaseRepository', () => {
  let db: Kysely<DB>;
  let repository: BayRepository;

  beforeAll(async () => {
    db = createDatabase({ connectionString: await createTestDatabase() });
    await sql`
      create table service_bay_fixture (
        id uuid primary key default uuidv7(),
        bay_name text not null,
        created_at timestamptz not null default now()
      )
    `.execute(db);
    repository = new BayRepository(new TransactionHost(db));
  });

  beforeEach(() => sql`truncate service_bay_fixture`.execute(db));

  afterAll(() => db.destroy());

  it('inserts a row and maps snake_case columns to camelCase', async () => {
    const bay = await repository.insert({ bayName: 'Bay 1' });

    expect(bay).toEqual({
      id: expect.any(String),
      bayName: 'Bay 1',
      createdAt: expect.any(Date),
    });
    await expect(repository.findById(bay.id)).resolves.toEqual(bay);
  });

  it('finds, checks and updates rows by id', async () => {
    const [a, b] = await Promise.all([
      repository.insert({ bayName: 'Bay A' }),
      repository.insert({ bayName: 'Bay B' }),
    ]);

    await expect(repository.existsById(a.id)).resolves.toBe(true);
    expect(
      (await repository.findByIds([a.id, b.id])).map((r) => r.bayName).sort(),
    ).toEqual(['Bay A', 'Bay B']);
    await expect(repository.findByIds([])).resolves.toEqual([]);
    await expect(
      repository.updateById(a.id, { bayName: 'Bay A (EV)' }),
    ).resolves.toMatchObject({
      bayName: 'Bay A (EV)',
    });
  });

  it('reports unknown ids as undefined, false or NOT_FOUND', async () => {
    const missing = '01a16194-0000-7000-8000-000000000000';

    await expect(repository.findById(missing)).resolves.toBeUndefined();
    await expect(repository.existsById(missing)).resolves.toBe(false);
    await expect(
      repository.updateById(missing, { bayName: 'x' }),
    ).resolves.toBeUndefined();
    await expect(repository.getById(missing)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      detail: `service bay fixture ${missing} was not found`,
    });
    await expect(repository.getById(missing)).rejects.toBeInstanceOf(AppError);
  });

  it('paginates and counts every matching row', async () => {
    for (const name of ['Bay 3', 'Bay 1', 'Bay 2'])
      await repository.insert({ bayName: name });

    const page = await repository.listByName({ page: 2, pageSize: 2 });

    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items.map((r) => r.bayName)).toEqual(['Bay 3']);
    expect(typeof page.total).toBe('number');
  });
});
