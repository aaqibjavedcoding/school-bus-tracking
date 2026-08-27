import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { LoginResponse } from '@school-bus-tracking/shared-types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `POST /api/v1/auth/login`
   *
   * Successful responses are wrapped into the standard `ApiResponse` envelope
   * by the global `TransformInterceptor`; failures (generic 401) are shaped by
   * the global `HttpExceptionFilter`.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }
}
