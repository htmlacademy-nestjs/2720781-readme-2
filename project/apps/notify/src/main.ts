import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { RabbitPublisher, rabbitServerOptions } from '@project/shared-core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  try {
    app.setGlobalPrefix('api');
    app.enableShutdownHooks();
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Readme — Notify')
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description:
            'Access JWT пользователя или служебный NOTIFY_HTTP_TOKEN',
        },
        'notify-trigger',
      )
      .build();
    SwaggerModule.setup('api/docs', app, () =>
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    await app.get(RabbitPublisher).ready();
    app.connectMicroservice(rabbitServerOptions(config, 'RABBITMQ_QUEUE'));
    await app.startAllMicroservices();
    await app.listen(config.getOrThrow<number>('PORT'));
    Logger.log('HTTP-триггер и RabbitMQ consumer запущены');
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch(() => {
  Logger.error(
    'Не удалось запустить Notify; проверьте конфигурацию и внешние сервисы',
  );
  process.exitCode = 1;
});
