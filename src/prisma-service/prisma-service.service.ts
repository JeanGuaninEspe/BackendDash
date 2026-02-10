import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor(private configService: ConfigService) {
        // Leer configuración directamente desde el archivo .env
        const dbUser = configService.get<string>('DB_USER');
        const dbPassword = configService.get<string>('DB_PASSWORD');
        const dbName = configService.get<string>('DB_NAME');
        const dbHost = configService.get<string>('HOST');
        const dbEncrypt = configService.get<string>('DB_ENCRYPT');
        const dbTrustCertificate = configService.get<string>('DB_TRUST_CERTIFICATE');
        
        // Validar que las variables requeridas estén presentes
        if (!dbUser || !dbPassword || !dbName || !dbHost) {
            throw new Error(
                'Configuración de base de datos incompleta. ' +
                'Debes proporcionar DB_USER, DB_PASSWORD, DB_NAME y HOST en el archivo .env'
            );
        }
        
        // Crear objeto de configuración para SQL Server según la documentación de Prisma
        const sqlConfig = {
            user: dbUser,
            password: dbPassword,
            database: dbName,
            server: dbHost,
            port: 1433,
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000,
            },
            options: {
                // Deshabilitar cifrado porque el servidor no soporta protocolos SSL/TLS modernos
                encrypt: false, // Deshabilitado para servidores que no soportan SSL/TLS moderno
                trustServerCertificate: true, // true para desarrollo local
                enableArithAbort: true,
                requestTimeout: 30000, // aumenta timeout de consultas a 30s
            },
        };
        
        // Crear el adapter de SQL Server para Prisma
        // El adapter acepta directamente el objeto de configuración
        const adapter = new PrismaMssql(sqlConfig);
        
        // Pasar el adapter al constructor de PrismaClient
        super({ adapter });
    }

    async onModuleInit() {  
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}
