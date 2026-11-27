import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { RabbitPublisher, rabbitServerOptions } from '@project/shared-core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Readme — Blog')
    .setDescription(
      'Данные сервиса хранятся в PostgreSQL. Доступ к БД через Prisma.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );

  const settings = app.get(ConfigService);
  await app.get(RabbitPublisher).ready();
  app.connectMicroservice(rabbitServerOptions(settings, 'RABBITMQ_BLOG_QUEUE'));
  await app.startAllMicroservices();
  const port = Number(settings.get('PORT') ?? 3001);
  await app.listen(port);
  Logger.log(`Readme Blog: http://localhost:${port}/api/docs`);
}

void bootstrap();
