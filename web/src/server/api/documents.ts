/**
 * Endpoint definitions for the `documents` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { BusDocumentListResponse, BusDocumentResponse, DocumentComplianceResponse, DocumentDeleteResponse, DocumentOverviewResponse, DocumentRequirementsResponse, DriverDocumentListResponse, DriverDocumentResponse, UserRole } from '@school-bus-tracking/shared-types';
import { DocumentComplianceService } from '../modules/documents/document-compliance.service';
import { DocumentsService } from '../modules/documents/documents.service';
import { CreateBusDocumentDto, CreateDriverDocumentDto, DocumentOverviewQueryDto, DocumentRequirementsQueryDto, ListDocumentsQueryDto, UpdateBusDocumentDto, UpdateDocumentRequirementsDto, UpdateDriverDocumentDto } from '../modules/documents/dto';
import { DocumentRequirementsService } from '../modules/documents/document-requirements.service';

/** `POST /api/v1/buses/:busId/documents` */
export const postBusesByBusIdDocuments: EndpointDefinition<CreateBusDocumentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateBusDocumentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    const dto = body;
    return container().documents().createBusDocument(schoolId, busId, dto);
  },};

/** `GET /api/v1/buses/:busId/documents` */
export const getBusesByBusIdDocuments: EndpointDefinition<unknown, ListDocumentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListDocumentsQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    return container().documents().listBusDocuments(schoolId, busId, query);
  },};

/** `GET /api/v1/buses/:busId/documents/compliance` */
export const getBusesByBusIdDocumentsCompliance: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    return container().documentCompliance().getBusCompliance(schoolId, busId);
  },
};

/** `GET /api/v1/buses/:busId/documents/:id` */
export const getBusesByBusIdDocumentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    const id = parseUuidParam(params['id']);
    return container().documents().findOneBusDocument(schoolId, busId, id);
  },
};

/** `PATCH /api/v1/buses/:busId/documents/:id` */
export const patchBusesByBusIdDocumentsById: EndpointDefinition<UpdateBusDocumentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateBusDocumentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().documents().updateBusDocument(schoolId, busId, id, dto);
  },};

/** `DELETE /api/v1/buses/:busId/documents/:id` */
export const deleteBusesByBusIdDocumentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    const id = parseUuidParam(params['id']);
    return container().documents().removeBusDocument(schoolId, busId, id);
  },
};

/** `GET /api/v1/document-requirements` */
export const getDocumentrequirements: EndpointDefinition<unknown, DocumentRequirementsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: DocumentRequirementsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().documentRequirements().list(schoolId, query.owner_type);
  },};

/** `PUT /api/v1/document-requirements` */
export const putDocumentrequirements: EndpointDefinition<UpdateDocumentRequirementsDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateDocumentRequirementsDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().documentRequirements().update(schoolId, dto.owner_type, dto);
  },};

/** `GET /api/v1/documents/overview` */
export const getDocumentsOverview: EndpointDefinition<unknown, DocumentOverviewQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: DocumentOverviewQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().documentCompliance().getOverview(schoolId, query);
  },};

/** `POST /api/v1/drivers/:driverId/documents` */
export const postDriversByDriverIdDocuments: EndpointDefinition<CreateDriverDocumentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateDriverDocumentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const driverId = parseUuidParam(params['driverId']);
    const dto = body;
    return container().documents().createDriverDocument(schoolId, driverId, dto);
  },};

/** `GET /api/v1/drivers/:driverId/documents` */
export const getDriversByDriverIdDocuments: EndpointDefinition<unknown, ListDocumentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListDocumentsQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const driverId = parseUuidParam(params['driverId']);
    return container().documents().listDriverDocuments(schoolId, driverId, query);
  },};

/** `GET /api/v1/drivers/:driverId/documents/compliance` */
export const getDriversByDriverIdDocumentsCompliance: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const driverId = parseUuidParam(params['driverId']);
    return container().documentCompliance().getDriverCompliance(schoolId, driverId);
  },
};

/** `GET /api/v1/drivers/:driverId/documents/:id` */
export const getDriversByDriverIdDocumentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const driverId = parseUuidParam(params['driverId']);
    const id = parseUuidParam(params['id']);
    return container().documents().findOneDriverDocument(schoolId, driverId, id);
  },
};

/** `PATCH /api/v1/drivers/:driverId/documents/:id` */
export const patchDriversByDriverIdDocumentsById: EndpointDefinition<UpdateDriverDocumentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateDriverDocumentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const driverId = parseUuidParam(params['driverId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().documents().updateDriverDocument(schoolId, driverId, id, dto);
  },};

/** `DELETE /api/v1/drivers/:driverId/documents/:id` */
export const deleteDriversByDriverIdDocumentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const driverId = parseUuidParam(params['driverId']);
    const id = parseUuidParam(params['id']);
    return container().documents().removeDriverDocument(schoolId, driverId, id);
  },
};
