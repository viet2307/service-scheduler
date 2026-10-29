import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/persistence/repositories';
import { DealershipResourcesController } from './dealership-resources.controller';
import { ReferenceDataService } from './reference-data.service';
import { ServiceTypesController } from './service-types.controller';

@Module({
  imports: [RepositoriesModule],
  controllers: [ServiceTypesController, DealershipResourcesController],
  providers: [ReferenceDataService],
})
export class ReferenceDataModule {}
