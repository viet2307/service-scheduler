import { ServiceInjectable } from '@/common/decorators';
import { ServiceTypeRepository } from '@/persistence/repositories';

@ServiceInjectable()
export class ReferenceDataService {
  constructor(private readonly serviceTypes: ServiceTypeRepository) {}

  listServiceTypes() {
    return this.serviceTypes.list();
  }
}
