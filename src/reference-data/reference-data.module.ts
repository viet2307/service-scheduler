import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/persistence/repositories';
import { ReferenceDataService } from './reference-data.service';
import { ServiceTypesController } from './service-types.controller';

@Module({
  imports: [RepositoriesModule],
  controllers: [ServiceTypesController],
  providers: [ReferenceDataService],
})
export class ReferenceDataModule {}
