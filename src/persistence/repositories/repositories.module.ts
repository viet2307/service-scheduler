import { Module } from '@nestjs/common';
import { ServiceTypeRepository } from './service-type.repository';

const repositories = [ServiceTypeRepository];

@Module({
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
