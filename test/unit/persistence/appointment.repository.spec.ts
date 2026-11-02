import type { Kysely } from 'kysely';
import type { DB } from '@/persistence/database.types';
import { AppointmentRepository } from '@/persistence/repositories';
import { TransactionHost } from '@/persistence/transaction-host';
import { appointment } from '../../support/fixtures';

describe('AppointmentRepository generic writes', () => {
  // No database: both writes must refuse before they reach it.
  const appointments = new AppointmentRepository(
    new TransactionHost({} as Kysely<DB>),
  );

  it('refuses the generic insert, so every booking goes through the idempotency key', async () => {
    await expect(
      // @ts-expect-error appointments are not inserted through the generic insert
      appointments.insert(appointment()),
    ).rejects.toThrow('only through insertIfKeyIsNew');
  });

  it('refuses the generic update, so a status change cannot skip the compare-and-set', async () => {
    await expect(
      appointments.updateById(
        '01a16194-0000-7000-8000-0000000000d1',
        // @ts-expect-error appointments are not updated through the generic update
        { status: 'CANCELLED', cancelledAt: new Date() },
      ),
    ).rejects.toThrow('compare-and-set');
  });
});
