import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

  async function bootstrap() {
    const app = await NestFactory.create(AppModule); 

    app.use(json({ limit: '30mb' }));
    app.use(urlencoded({ extended: true, limit: '30mb' }));
     app.enableCors({
       origin: [
         'http://localhost:4321',
         'http://192.168.80.39:4321',
         'http://192.168.80.39:3001',
         'https://vial25dash.pages.dev',
         'https://0q44x1tx-4321.use2.devtunnels.ms',
       ],
       credentials: true,
     });
    app.setGlobalPrefix('api');
    // Configuración global de ValidationPipe para class-validator
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, // Elimina propiedades que no están en el DTO
        forbidNonWhitelisted: true, // Lanza error si se envían propiedades no permitidas
        transform: true, // Transforma automáticamente los tipos (ej: string a number)
        transformOptions: {
          enableImplicitConversion: true, // Permite conversión implícita de tipos
        },
      }),
      
    );

    await app.listen(process.env.PORT ?? 3000);
  }
bootstrap();
