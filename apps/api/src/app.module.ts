import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './database/database.module';
import { appConfig, databaseConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule.forRoot(),
    HealthModule,
  ],
})
export class AppModule {}
