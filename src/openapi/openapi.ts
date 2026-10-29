import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Service Scheduler API')
    .setDescription(
      'Books a qualified technician and a compatible service bay for a vehicle service. Errors use RFC 9457 application/problem+json.',
    )
    .setVersion('1')
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/, '')}_${method}`,
  });
}
