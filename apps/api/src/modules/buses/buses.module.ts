import { Module } from '@nestjs/common';
import { Bus } from '../../database/models';
import { BusesController } from './buses.controller';
import { BusesService } from './buses.service';
import { BUSES_REPOSITORY } from './buses.constants';

/**
 * Fleet (bus) management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
 */
@Module({
  controllers: [BusesController],
  providers: [BusesService, { provide: BUSES_REPOSITORY, useValue: Bus }],
  exports: [BusesService],
})
export class BusesModule {}
