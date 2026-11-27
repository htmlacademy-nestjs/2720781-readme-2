import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { RabbitPublisher, rabbitServerOptions } from '@project/shared-core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Readme — API сервиса User')
    .setDescription(
      'Регистрация, access/refresh токены, смена пароля и профили. Пользователи хранятся в MongoDB.',
    )
    .setVersion('1.0.0')
    .addTag('auth', 'Регистрация и аутентификация')
    .addTag('users', 'Профили пользователей')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(`${globalPrefix}/docs`, app, () =>
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const config = app.get(ConfigService);
  app.enableShutdownHooks();
  await app.get(RabbitPublisher).ready();
  app.connectMicroservice(rabbitServerOptions(config, 'RABBITMQ_USER_QUEUE'));
  await app.startAllMicroservices();
  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
