import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { User } from '../../database/models';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { USERS_REPOSITORY } from './auth.constants';

@Module({
  imports: [
    // Secret and expiry always come from configuration (environment) —
    // see `config/jwt.config.ts`.
    JwtModule.registerAsync({
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
    // The `User` model class is provided behind a token instead of
    // `SequelizeModule.forFeature` so the app still boots while
    // DB_AUTO_CONNECT=false, and unit tests can substitute a stub.
    { provide: USERS_REPOSITORY, useValue: User },
  ],
  exports: [AuthService],
})
export class AuthModule {}
