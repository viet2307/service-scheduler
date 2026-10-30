import { Injectable } from '@nestjs/common';
import {
  Insertable,
  Kysely,
  Selectable,
  SelectQueryBuilder,
  sql,
  Updateable,
} from 'kysely';
import type { Page, PageRequest } from '@/common/dto';
import { AppError } from '@/common/errors';
import type { DB } from './database.types';
import { TransactionHost } from './transaction-host';

type TableWithId = Extract<
  { [K in keyof DB]: DB[K] extends { id: unknown } ? K : never }[keyof DB],
  string
>;

type Row<T extends TableWithId> = Selectable<DB[T]>;

/** Kysely cannot resolve columns of a generic table, so shared queries run against this shape and are cast back. */
type AnyDB = Record<string, Record<string, unknown>>;

// Emits the constructor's parameter types, which subclasses without their own constructor inherit for injection.
@Injectable()
export abstract class BaseRepository<T extends TableWithId> {
  protected abstract readonly table: T;

  constructor(protected readonly transactionHost: TransactionHost) {}

  /** The active transaction, or the pool. */
  protected get db(): Kysely<DB> {
    return this.transactionHost.executor;
  }

  private get anyDb(): Kysely<AnyDB> {
    return this.db as unknown as Kysely<AnyDB>;
  }

  private get tableName(): string {
    return this.table;
  }

  /** `serviceType` or `service_type` → `service type`, for error messages. */
  private get resourceName(): string {
    return this.tableName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .toLowerCase();
  }

  async findById(id: string): Promise<Row<T> | undefined> {
    const row = await this.anyDb
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row as Row<T> | undefined;
  }

  async getById(id: string): Promise<Row<T>> {
    const row = await this.findById(id);
    if (!row) throw AppError.notFound(this.resourceName, id);
    return row;
  }

  async findByIds(ids: readonly string[]): Promise<Row<T>[]> {
    if (!ids.length) return [];
    const rows = await this.anyDb
      .selectFrom(this.tableName)
      .selectAll()
      .where('id', 'in', ids)
      .execute();
    return rows as Row<T>[];
  }

  async existsById(id: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom(this.tableName)
      .select(sql<number>`1`.as('found'))
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  async insert(values: Insertable<DB[T]>): Promise<Row<T>> {
    const row = await this.anyDb
      .insertInto(this.tableName)
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as Row<T>;
  }

  async updateById(
    id: string,
    values: Updateable<DB[T]>,
  ): Promise<Row<T> | undefined> {
    const row = await this.anyDb
      .updateTable(this.tableName)
      .set(values as Record<string, unknown>)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row as Row<T> | undefined;
  }

  protected async paginate<TB extends keyof DB, O>(
    query: SelectQueryBuilder<DB, TB, O>,
    { page, pageSize }: PageRequest,
  ): Promise<Page<O>> {
    const filtered = query
      .clearSelect()
      .clearOrderBy()
      .select(sql<number>`1`.as('one'))
      .as('filtered');

    const [items, { total }] = await Promise.all([
      query
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      this.db
        .selectFrom(filtered)
        .select((eb) =>
          eb.cast<number>(eb.fn.countAll(), 'integer').as('total'),
        )
        .executeTakeFirstOrThrow(),
    ]);
    return { items, total, page, pageSize };
  }
}
