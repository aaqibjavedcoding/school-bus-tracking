import { Module } from '@nestjs/common';
import { Route, Stop } from '../../database/models';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { ROUTES_REPOSITORY, ROUTES_STOPS_REPOSITORY } from './routes.constants';

/**
 * Route management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
 */
@Module({
  controllers: [RoutesController],
  providers: [
    RoutesService,
    { provide: ROUTES_REPOSITORY, useValue: Route },
    { provide: ROUTES_STOPS_REPOSITORY, useValue: Stop },
  ],
  exports: [RoutesService],
})
export class RoutesModule {}
