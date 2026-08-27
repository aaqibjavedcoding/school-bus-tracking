import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthTestModule } from './modules/auth-test/auth-test.module';
import { DatabaseModule } from './database/database.module';
import { appConfig, databaseConfig, jwtConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule.forRoot(),
    HealthModule,
    AuthModule,
    AuthTestModule,
  ],
})
export class AppModule {}
