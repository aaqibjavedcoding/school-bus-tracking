import { Module } from '@nestjs/common';
import {
  Bus,
  BusDocument,
  DocumentRequirement as DocumentRequirementModel,
  DriverDocument,
  User,
} from '../../database/models';
import { BusDocumentsController } from './bus-documents.controller';
import { DriverDocumentsController } from './driver-documents.controller';
import { DocumentComplianceService } from './document-compliance.service';
import { DocumentRequirementsController } from './document-requirements.controller';
import { DocumentRequirementsService } from './document-requirements.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import {
  BUS_DOCUMENTS_REPOSITORY,
  DOCUMENTS_BUS_REPOSITORY,
  DOCUMENTS_USER_REPOSITORY,
  DOCUMENT_REQUIREMENTS_REPOSITORY,
  DRIVER_DOCUMENTS_REPOSITORY,
} from './documents.constants';

/**
 * Compliance-document management (Task 44).
 *
 * Bus documents, driver documents, the school-wide compliance overview and the
 * requirement configuration live in one module because they share the same
 * requirement catalogue and the same derived-validity engine — splitting them
 * would only duplicate those.
 *
 * Model classes are provided behind tokens so the app still boots with
 * `DB_AUTO_CONNECT=false` and unit tests can inject in-memory stubs.
 */
@Module({
  controllers: [
    BusDocumentsController,
    DriverDocumentsController,
    DocumentsController,
    DocumentRequirementsController,
  ],
  providers: [
    DocumentsService,
    DocumentComplianceService,
    DocumentRequirementsService,
    { provide: BUS_DOCUMENTS_REPOSITORY, useValue: BusDocument },
    { provide: DRIVER_DOCUMENTS_REPOSITORY, useValue: DriverDocument },
    { provide: DOCUMENT_REQUIREMENTS_REPOSITORY, useValue: DocumentRequirementModel },
    { provide: DOCUMENTS_BUS_REPOSITORY, useValue: Bus },
    { provide: DOCUMENTS_USER_REPOSITORY, useValue: User },
  ],
  exports: [DocumentsService, DocumentComplianceService, DocumentRequirementsService],
})
export class DocumentsModule {}
