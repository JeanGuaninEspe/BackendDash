import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma-service/prisma-service.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { VentasTagModule } from './ventas-tag/ventas-tag.module';
import { FacturacionModule } from './facturacion/facturacion.module';
import { TransitosModule } from './transitos/transitos.module';
import { RecaudacionModule } from './recaudacion/recaudacion.module';
import { REstadisticoModule } from './r-estadistico/r-estadistico.module';
import { DashboardAiModule } from './dashboard-ai/dashboard-ai.module';

@Module({
  imports: [ConfigModule.forRoot({
      isGlobal: true, // Hace que ConfigModule esté disponible globalmente
      envFilePath: '.env', // Ruta al archivo .env
    }), AuthModule, VentasTagModule, FacturacionModule, TransitosModule, RecaudacionModule, REstadisticoModule, DashboardAiModule],
  controllers: [AppController],
  providers: [AppService, PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
