import { Module } from '@nestjs/common';
import { Route, Stop } from '../../database/models';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';
import { STOPS_REPOSITORY, STOPS_ROUTES_REPOSITORY } from './stops.constants';

/**
 * Stop management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
 */
@Module({
  controllers: [StopsController],
  providers: [
    StopsService,
    { provide: STOPS_REPOSITORY, useValue: Stop },
    { provide: STOPS_ROUTES_REPOSITORY, useValue: Route },
  ],
  exports: [StopsService],
})
export class StopsModule {}
