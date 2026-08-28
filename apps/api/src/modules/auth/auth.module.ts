import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RefreshToken, User } from '../../database/models';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { REFRESH_TOKENS_REPOSITORY, USERS_REPOSITORY } from './auth.constants';

@Module({
  imports: [
    // Secret and expiry always come from configuration (environment) —
    // see `config/jwt.config.ts`. Registered as a *global* module so the
    // single, centrally configured `JwtService` is injectable by guards in
    // every feature module (e.g. `JwtAuthGuard`) without re-registration.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiresIn', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // The `User` and `RefreshToken` model classes are provided behind tokens
    // instead of `SequelizeModule.forFeature` so the app still boots while
    // DB_AUTO_CONNECT=false, and unit tests can substitute stubs.
    //
    // Initialization of these classes is owned by `DatabaseModule.forRoot()`,
    // which registers every domain model with the Sequelize connection so
    // `User.unscoped()` works at login.
    { provide: USERS_REPOSITORY, useValue: User },
    { provide: REFRESH_TOKENS_REPOSITORY, useValue: RefreshToken },
  ],
  exports: [AuthService],
})
export class AuthModule {}
