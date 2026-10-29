import { ServiceInjectable } from '@/common/decorators';
import {
  BayRepository,
  DealershipRepository,
  ServiceTypeRepository,
  TechnicianRepository,
} from '@/persistence/repositories';

@ServiceInjectable()
export class ReferenceDataService {
  constructor(
    private readonly serviceTypes: ServiceTypeRepository,
    private readonly dealerships: DealershipRepository,
    private readonly technicians: TechnicianRepository,
    private readonly bays: BayRepository,
  ) {}

  listServiceTypes() {
    return this.serviceTypes.list();
  }

  /** NOT_FOUND for an unknown dealership, so it is not mistaken for one without technicians. */
  async listTechnicians(dealershipId: string) {
    const [, technicians] = await Promise.all([
      this.dealerships.getById(dealershipId),
      this.technicians.listByDealership(dealershipId),
    ]);
    return technicians;
  }

  async listBays(dealershipId: string) {
    const [, bays] = await Promise.all([
      this.dealerships.getById(dealershipId),
      this.bays.listByDealership(dealershipId),
    ]);
    return bays;
  }
}
