import {
  DataFileFormat,
  ImportModule,
  type ImportModuleListResponse,
  type ImportTemplateDescriptor,
} from '@school-bus-tracking/shared-types';
import {
  buildCsv,
  buildWorkbookBuffer,
  downloadFileName,
  type SheetCell,
} from '../excel/excel.util';
import { IMPORT_DEFINITIONS, IMPORT_MODULE_ORDER, getImportDefinition } from './definitions';
import type { ImportDefinition } from './import.types';

/** A generated file ready to be streamed back to the browser. */
export interface GeneratedFile {
  buffer: Buffer;
  fileName: string;
  format: DataFileFormat;
}

/**
 * Builds the downloadable import templates.
 *
 * A template is not just a header row: it ships an *Instructions* sheet and an
 * inline grey notes row so an admin filling it in knows what each column means,
 * which ones are mandatory, and what the accepted values look like. Every
 * column here is derived from the module's own definition, which in turn is
 * derived from the real Zod row schema — so a template can never advertise a
 * field the domain model does not have.
 */
export class ImportTemplateService {
  /** Metadata for every importable module, used by the web wizard. */
  listModules(): ImportModuleListResponse {
    return {
      items: IMPORT_MODULE_ORDER.map((module) => this.describe(getImportDefinition(module))),
    };
  }

  /** Metadata for a single module. */
  describeModule(module: ImportModule): ImportTemplateDescriptor {
    return this.describe(IMPORT_DEFINITIONS[module]);
  }

  /** Builds the template workbook (or CSV) for one module. */
  async buildTemplate(module: ImportModule, format: DataFileFormat): Promise<GeneratedFile> {
    const definition = IMPORT_DEFINITIONS[module];
    const columns = definition.columns.map((column) => ({
      header: column.header,
      width: Math.min(40, Math.max(16, column.header.length + 6)),
    }));

    const sampleRow: SheetCell[] = definition.columns.map((column) => column.example ?? '');
    const fileBase = `${module}_import_template`;

    if (format === DataFileFormat.CSV) {
      // CSV has no room for notes or a second sheet; the header row plus one
      // example row is the most a CSV template can honestly carry.
      return {
        buffer: buildCsv(columns, [sampleRow]),
        fileName: downloadFileName(fileBase, DataFileFormat.CSV),
        format,
      };
    }

    const notes = definition.columns.map((column) =>
      [
        column.required ? 'Required.' : 'Optional.',
        column.description,
        column.allowed_values?.length ? `One of: ${column.allowed_values.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );

    const buffer = await buildWorkbookBuffer([
      {
        sheetName: 'Data',
        columns,
        notes,
        rows: [sampleRow],
      },
      {
        sheetName: 'Instructions',
        columns: [
          { header: 'Column', width: 28 },
          { header: 'Required', width: 12 },
          { header: 'What to enter', width: 62 },
          { header: 'Example', width: 24 },
        ],
        rows: this.instructionRows(definition),
      },
    ]);

    return {
      buffer,
      fileName: downloadFileName(fileBase, DataFileFormat.XLSX),
      format,
    };
  }

  /**
   * The Instructions sheet: the per-column reference, preceded by the rules
   * that apply to the file as a whole.
   */
  private instructionRows(definition: ImportDefinition): SheetCell[][] {
    const preamble: SheetCell[][] = [
      ['What one row means', '', definition.description, ''],
      [
        'Duplicate detection',
        '',
        `Rows are matched on: ${definition.naturalKeyLabel}. A repeated value inside the file is reported, not imported twice.`,
        '',
      ],
      [
        'Row limit',
        '',
        `Up to ${definition.maxRows.toLocaleString('en-US')} data rows per file. Split larger uploads.`,
        '',
      ],
      [
        'Before you upload',
        '',
        'Keep the header row exactly as it is, delete the grey notes row and the example row, then fill one record per row.',
        '',
      ],
      [
        'Dates and times',
        '',
        'Dates use YYYY-MM-DD (for example 2026-04-01) and times use HH:MM in 24-hour form.',
        '',
      ],
      ['', '', '', ''],
    ];

    const columns: SheetCell[][] = definition.columns.map((column) => [
      column.header,
      column.required ? 'Yes' : 'No',
      column.allowed_values?.length
        ? `${column.description} One of: ${column.allowed_values.join(', ')}.`
        : column.description,
      column.example ?? '',
    ]);

    return [...preamble, ...columns];
  }
  private describe(definition: ImportDefinition): ImportTemplateDescriptor {
    return {
      module: definition.module,
      label: definition.label,
      description: definition.description,
      natural_key: definition.naturalKeyLabel,
      max_rows: definition.maxRows,
      supports_upsert: definition.supportsUpsert,
      columns: definition.columns.map((column) => ({
        header: column.header,
        required: column.required,
        description: column.description,
        example: column.example,
        ...(column.allowed_values ? { allowed_values: column.allowed_values } : {}),
      })),
    };
  }
}
