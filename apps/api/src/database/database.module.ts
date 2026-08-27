import { Module, DynamicModule, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { databaseProviders } from './database.providers';
import { models } from './models';

@Module({
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    const isDbAutoConnect = process.env.DB_AUTO_CONNECT === 'true';
    const logger = new Logger('DatabaseModule');

    if (!isDbAutoConnect) {
      logger.log('Database auto-connect is disabled (Phase 1). Database infrastructure ready.');
      return {
        module: DatabaseModule,
        providers: [...databaseProviders],
        exports: [...databaseProviders],
      };
    }

    return {
      module: DatabaseModule,
      imports: [
        SequelizeModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            dialect: 'postgres',
            host: configService.get<string>('database.host', 'localhost'),
            port: configService.get<number>('database.port', 5432),
            username: configService.get<string>('database.username', 'postgres'),
            password: configService.get<string>('database.password', 'postgres'),
            database: configService.get<string>('database.name', 'school_bus_tracking'),
            // Domain models are declared once in `database/models/index.ts`.
            // `autoLoadModels` additionally picks up models registered by
            // feature modules through `SequelizeModule.forFeature()`.
            models,
            autoLoadModels: true,
            // Schema changes come from migrations only — never from the ORM.
            synchronize: false,
            sync: { force: false, alter: false },
            logging: configService.get<boolean>('database.logging', false)
              ? (msg: string) => console.log(msg)
              : false,
            pool: {
              max: configService.get<number>('database.pool.max', 20),
              min: configService.get<number>('database.pool.min', 2),
              acquire: configService.get<number>('database.pool.acquire', 30000),
              idle: configService.get<number>('database.pool.idle', 10000),
            },
            ssl: configService.get<boolean>('database.ssl', false),
            retryAttempts: 2,
            retryDelay: 3000,
          }),
        }),
      ],
      providers: [...databaseProviders],
      exports: [SequelizeModule, ...databaseProviders],
    };
  }
}
