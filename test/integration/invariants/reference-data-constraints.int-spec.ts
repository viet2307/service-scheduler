import { Kysely } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { PgErrorCode } from '@/persistence/pg-errors';
import { createMigratedTestDatabase } from '../../support/database';
import { createScenario, scenario } from '../../support/fixtures';

describe('reference data constraints', () => {
  let db: Kysely<DB>;

  const check = (constraint: string) => ({
    code: PgErrorCode.CHECK_VIOLATION,
    constraint,
  });

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
    await createScenario(db);
  });

  afterAll(() => db.destroy());

  it.each(['WVWZZZ1KZAW00000I', 'WVWZZZ1KZAW0000', 'wvwzzz1kzaw000009'])(
    'rejects the VIN %s',
    async (vin) => {
      await expect(
        db
          .insertInto('vehicle')
          .values({
            vin,
            customerId: scenario.customerId,
            make: 'VW',
            model: 'Golf',
          })
          .execute(),
      ).rejects.toMatchObject(check('vehicle_vin_format_valid'));
    },
  );

  it('rejects a VIN that is already registered', async () => {
    await expect(
      db
        .insertInto('vehicle')
        .values({
          vin: 'WVWZZZ1KZAW000001',
          customerId: scenario.customerId,
          make: 'VW',
          model: 'Golf',
        })
        .execute(),
    ).rejects.toMatchObject({
      code: PgErrorCode.UNIQUE_VIOLATION,
      constraint: 'vehicle_vin_uq',
    });
  });

  it.each([0, 721])(
    'rejects a service duration of %i minutes',
    async (minutes) => {
      await expect(
        db
          .insertInto('serviceType')
          .values({
            code: `INVALID_${minutes}`,
            name: 'Invalid',
            durationMinutes: minutes,
            requiredSkill: 'GENERAL',
            requiredBayType: 'LIFT',
          })
          .execute(),
      ).rejects.toMatchObject(check('service_type_duration_valid'));
    },
  );

  it.each([
    [
      'closes before it opens',
      7,
      '17:00',
      '08:00',
      'dealership_opening_hours_interval_valid',
    ],
    [
      'uses ISO weekday 8',
      8,
      '08:00',
      '17:00',
      'dealership_opening_hours_iso_weekday_valid',
    ],
  ])(
    'rejects opening hours that %s',
    async (_, isoWeekday, opensAt, closesAt, constraint) => {
      await expect(
        db
          .insertInto('dealershipOpeningHours')
          .values({
            dealershipId: scenario.otherDealershipId,
            isoWeekday,
            opensAt,
            closesAt,
          })
          .execute(),
      ).rejects.toMatchObject(check(constraint));
    },
  );

  it('rejects a second bay with the same name in one dealership', async () => {
    await expect(
      db
        .insertInto('serviceBay')
        .values({
          dealershipId: scenario.dealershipId,
          name: 'Bay 1',
          bayType: 'LIFT',
        })
        .execute(),
    ).rejects.toMatchObject({
      code: PgErrorCode.UNIQUE_VIOLATION,
      constraint: 'service_bay_name_uq',
    });
  });
});
