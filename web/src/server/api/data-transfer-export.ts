/**
 * Endpoint definitions for the `data-transfer/export` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { streamFileResponse } from '../http/file-response';
import { DataFileFormat, EXPORT_DATASET_LABELS, EXPORT_DATASET_VALUES, UserRole } from '@school-bus-tracking/shared-types';
import { sanitizeFileName } from '../modules/data-transfer/excel/excel.util';
import { ExportDatasetParamDto, ExportQueryDto } from '../modules/data-transfer/dto/export.dto';
import { ExportService } from '../modules/data-transfer/export/export.service';

/** `GET /api/v1/exports` */
export const getExports: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return {
    items: EXPORT_DATASET_VALUES.map((dataset) => ({
    dataset,
    label: EXPORT_DATASET_LABELS[dataset],
    })),
    };
  },
};

/**
 * `GET /api/v1/exports/:dataset`
 *
 * Streams the dataset as `.xlsx` (default) or `.csv`. Returning a `Response`
 * bypasses the JSON envelope exactly as `@Res()` without passthrough did, and
 * the rows still flow 500 at a time straight from the database to the socket.
 */
export const getExportsByDataset: EndpointDefinition<unknown, ExportQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'data_export',
  status: HttpStatus.OK,
  queryType: ExportQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const userId = user.id;
    const routeParams = await validateDto(ExportDatasetParamDto, params, 'param');
    const typedQuery = query;

    const plan = await container()
      .exports()
      .prepare(schoolId, userId, routeParams.dataset, typedQuery);

    const format = typedQuery.format ?? DataFileFormat.XLSX;
    const safeName = sanitizeFileName(plan.fileName, `export.${format}`);

    return streamFileResponse({
      contentType: plan.contentType,
      fileName: safeName,
      totalRecords: plan.total,
      produce: (sink) => plan.stream(sink),
    });
  },};
