import { ApiExposeProperty } from '@/common/decorators';
import { BaseController } from '@/common/base.controller';

class TechnicianDto {
  @ApiExposeProperty()
  displayName: string;
}

class AppointmentDto {
  @ApiExposeProperty()
  id: string;

  @ApiExposeProperty({ type: TechnicianDto })
  technician: TechnicianDto;

  @ApiExposeProperty()
  startAt: Date;
}

class TestController extends BaseController {
  one = (data: object) => this.toDto(data, AppointmentDto);
  page = (items: object[]) =>
    this.toPage({ items, total: 7, page: 2, pageSize: 1 }, AppointmentDto);
}

describe('BaseController', () => {
  const controller = new TestController();
  const row = {
    id: 'a1',
    idempotencyKey: 'secret-key',
    startAt: new Date('2026-11-02T02:00:00Z'),
    technician: { displayName: 'Linh Tran', email: 'linh@example.com' },
  };

  it('keeps only exposed properties, including in nested DTOs', () => {
    const dto = controller.one(row);

    expect(dto).toBeInstanceOf(AppointmentDto);
    expect(JSON.parse(JSON.stringify(dto))).toEqual({
      id: 'a1',
      startAt: '2026-11-02T02:00:00.000Z',
      technician: { displayName: 'Linh Tran' },
    });
  });

  it('maps every item of a page and keeps its metadata', () => {
    const page = controller.page([row]);

    expect(page).toMatchObject({ total: 7, page: 2, pageSize: 1 });
    expect(page.items[0]).toBeInstanceOf(AppointmentDto);
    expect(page.items[0]).not.toHaveProperty('idempotencyKey');
  });
});
