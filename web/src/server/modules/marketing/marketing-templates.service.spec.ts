import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { MarketingTemplateStatus } from '@school-bus-tracking/shared-types';
import type {
  MarketingTemplateContentInput,
  MarketingTemplateCreateRequest,
} from '@school-bus-tracking/shared-types';
import { MarketingTemplatesService } from './marketing-templates.service';

/**
 * Template lifecycle against stub repositories: draft creation, in-place
 * draft edits, the publish one-way door, the new-draft-after-publish rule,
 * archiving, placeholder validation, HTML safety and preview rendering.
 *
 * The stubs mirror the surfaces the service touches (`findOne`, `findAll`,
 * `create`, `count`, `update`, `reload`) — the same seam the admin services
 * use in their specs.
 */

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_1 = '22222222-2222-4222-8222-222222222222';
const VERSION_2 = '33333333-3333-4333-8333-333333333333';

const NOW = new Date('2026-09-27T10:00:00.000Z');

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  status: MarketingTemplateStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  template_id: string;
  version: number;
  subject: string;
  html_body: string;
  text_body: string;
  allowed_variables: Array<Record<string, unknown>>;
  created_by: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function makeVersionRow(templateId: string, overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: overrides.id ?? `version-${Math.random().toString(36).slice(2)}`,
    template_id: templateId,
    version: 1,
    subject: 'Hello {{school_name}}',
    html_body: '<p>Hello {{school_name}}</p>',
    text_body: 'Hello {{school_name}}',
    allowed_variables: [
      { name: 'school_name', required: true, description: null, example: 'Lincoln High' },
    ],
    created_by: ACTOR,
    published_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeTemplateRow(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: TEMPLATE_ID,
    name: 'Welcome email',
    slug: 'welcome-email',
    status: MarketingTemplateStatus.DRAFT,
    created_by: ACTOR,
    updated_by: ACTOR,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/**
 * Wraps a raw row in the instance-ish shape. `update` mutates the row itself
 * (as Sequelize does), so re-fetching through the stub observes the change —
 * that identity is what the immutability tests rely on.
 */
function instanceOf(row: Record<string, unknown>) {
  const record = row as Record<string, unknown> & {
    update: (patch: Record<string, unknown>) => Promise<void>;
    reload: () => Promise<void>;
  };
  record.update = async (patch: Record<string, unknown>) => {
    Object.assign(record, patch);
  };
  record.reload = async () => undefined;
  return record;
}

function makeRepositories(
  templates: TemplateRow[] = [],
  versions: VersionRow[] = [],
  options: { duplicateSlug?: boolean } = {},
) {
  const templateRows = [...templates];
  const versionRows = [...versions];
  const created: { templates: unknown[]; versions: unknown[] } = {
    templates: [],
    versions: [],
  };

  const templatesRepo = {
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      const row = templateRows.find((candidate) => candidate.id === where.id);
      return row ? (instanceOf(row as unknown as Record<string, unknown>) as never) : null;
    },
    findAll: async () =>
      templateRows.map((row) => instanceOf(row as unknown as Record<string, unknown>) as never),
    count: async () => templateRows.length,
    create: async (payload: Record<string, unknown>) => {
      if (options.duplicateSlug) {
        const { UniqueConstraintError } = await import('sequelize');
        throw new UniqueConstraintError({ errors: [] });
      }
      const row = { ...makeTemplateRow(), ...payload } as TemplateRow;
      templateRows.push(row);
      created.templates.push(payload);
      return instanceOf(row as unknown as Record<string, unknown>) as never;
    },
  };

  const versionsRepo = {
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      const row = versionRows.find(
        (candidate) =>
          candidate.id === where.id &&
          (where.template_id === undefined || candidate.template_id === where.template_id),
      );
      return row ? (instanceOf(row as unknown as Record<string, unknown>) as never) : null;
    },
    findAll: async ({ where }: { where: Record<string, unknown> }) => {
      const templateCondition = where.template_id as Record<PropertyKey, unknown> | undefined;
      const inList = templateCondition?.[Op.in] as string[] | undefined;
      const rows = versionRows.filter((candidate) => {
        if (inList) {
          return inList.includes(candidate.template_id);
        }
        return where.template_id === undefined || candidate.template_id === where.template_id;
      });
      // Newest first, mirroring the service's expectations.
      return rows
        .sort((a, b) => b.version - a.version)
        .map((row) => instanceOf(row as unknown as Record<string, unknown>) as never);
    },
    create: async (payload: Record<string, unknown>) => {
      const row = { ...makeVersionRow(String(payload.template_id)), ...payload } as VersionRow;
      versionRows.push(row);
      created.versions.push(payload);
      return instanceOf(row as unknown as Record<string, unknown>) as never;
    },
  };

  return { templatesRepo, versionsRepo, templateRows, versionRows, created };
}

function makeService(
  templates: TemplateRow[] = [],
  versions: VersionRow[] = [],
  options: { duplicateSlug?: boolean; testRecipients?: string[] } = {},
) {
  const repos = makeRepositories(templates, versions, options);
  const sent: Array<Record<string, unknown>> = [];
  const provider = {
    name: 'noop-email',
    isConfigured: true,
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { success: true, provider: 'noop-email', messageId: 'x', retryable: false };
    },
  };
  const service = new MarketingTemplatesService(
    repos.templatesRepo as never,
    repos.versionsRepo as never,
    provider as never,
    () => options.testRecipients ?? [],
  );
  return { service, repos, sent };
}

const VALID_CONTENT: MarketingTemplateContentInput = {
  subject: 'Welcome {{school_name}}',
  html_body: '<p>Welcome {{school_name}} — <a href="https://kidbus.example">learn more</a></p>',
  text_body: 'Welcome {{school_name}}',
  allowed_variables: [
    { name: 'school_name', required: true, description: null, example: 'Lincoln High' },
  ],
};

describe('MarketingTemplatesService — draft lifecycle', () => {
  it('creates a template with its first draft version', async () => {
    const { service, repos } = makeService();
    const dto: MarketingTemplateCreateRequest = {
      name: 'Welcome email',
      slug: 'welcome-email',
      content: VALID_CONTENT,
    };
    const result = await service.create(ACTOR, dto);

    assert.equal(result.template.slug, 'welcome-email');
    assert.equal(result.template.status, MarketingTemplateStatus.DRAFT);
    assert.equal(result.version.version, 1);
    assert.equal(result.version.published_at, null, 'a fresh version is a draft');
    assert.equal(repos.templateRows.length, 1);
    assert.equal(repos.versionRows.length, 1);
    assert.equal(repos.versionRows[0].subject, 'Welcome {{school_name}}');
  });

  it('conflicts on a duplicate slug', async () => {
    const { service } = makeService([], [], { duplicateSlug: true });
    await assert.rejects(
      service.create(ACTOR, {
        name: 'Welcome email',
        slug: 'welcome-email',
        content: VALID_CONTENT,
      }),
      ConflictException,
    );
  });

  it('updates a draft version in place', async () => {
    const { service, repos } = makeService(
      [makeTemplateRow()],
      [makeVersionRow(TEMPLATE_ID, { id: VERSION_1, version: 1 })],
    );
    const result = await service.saveContent(ACTOR, TEMPLATE_ID, {
      ...VALID_CONTENT,
      subject: 'Updated subject {{school_name}}',
    });

    assert.equal(repos.versionRows.length, 1, 'no new version row for a draft edit');
    assert.equal(result.version.version, 1);
    assert.equal(result.version.subject, 'Updated subject {{school_name}}');
    assert.equal(result.version.id, VERSION_1);
  });

  it('publishes a draft version once and only once', async () => {
    const { service } = makeService(
      [makeTemplateRow()],
      [makeVersionRow(TEMPLATE_ID, { id: VERSION_1, version: 1 })],
    );

    const published = await service.publishVersion(ACTOR, TEMPLATE_ID, VERSION_1);
    assert.match(
      published.version.published_at ?? '',
      /^\d{4}-\d{2}-\d{2}T/,
      'published_at is set',
    );
    assert.equal(published.template.status, MarketingTemplateStatus.PUBLISHED);

    // The one-way door: a second publish is a conflict, not a no-op.
    await assert.rejects(
      service.publishVersion(ACTOR, TEMPLATE_ID, VERSION_1),
      (error: { getStatus?: () => number; message?: string }) => {
        assert.equal(error.getStatus?.(), 409);
        return true;
      },
    );
  });

  it('opens a NEW draft version after the newest one is published (immutability)', async () => {
    const { service, repos } = makeService(
      [
        makeTemplateRow({
          status: MarketingTemplateStatus.PUBLISHED,
        }),
      ],
      [makeVersionRow(TEMPLATE_ID, { id: VERSION_1, version: 1, published_at: NOW })],
    );

    const result = await service.saveContent(ACTOR, TEMPLATE_ID, VALID_CONTENT);

    assert.equal(repos.versionRows.length, 2, 'a new version row is opened');
    assert.equal(result.version.version, 2);
    assert.equal(result.version.id !== VERSION_1, true);
    // The published row was never touched.
    assert.equal(repos.versionRows[0].subject, 'Hello {{school_name}}');
    assert.notEqual(repos.versionRows[0].published_at, null);
  });

  it('archives a template and then refuses content edits and re-archive', async () => {
    const { service } = makeService(
      [makeTemplateRow({ status: MarketingTemplateStatus.ARCHIVED })],
      [makeVersionRow(TEMPLATE_ID, { id: VERSION_1 })],
    );

    await assert.rejects(service.saveContent(ACTOR, TEMPLATE_ID, VALID_CONTENT), ConflictException);
    await assert.rejects(service.publishVersion(ACTOR, TEMPLATE_ID, VERSION_1), ConflictException);
    await assert.rejects(service.archive(ACTOR, TEMPLATE_ID), ConflictException);
  });

  it('throws 404 for unknown templates and versions', async () => {
    const { service } = makeService();
    await assert.rejects(service.findOneOrThrow(TEMPLATE_ID), NotFoundException);
    await assert.rejects(service.publishVersion(ACTOR, TEMPLATE_ID, VERSION_1), NotFoundException);
  });

  it('lists templates with version statistics', async () => {
    const { service } = makeService(
      [makeTemplateRow()],
      [
        makeVersionRow(TEMPLATE_ID, { id: VERSION_1, version: 1, published_at: NOW }),
        makeVersionRow(TEMPLATE_ID, { id: VERSION_2, version: 2, published_at: null }),
      ],
    );
    const list = await service.list({ page: 1, limit: 20 });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].version_count, 2);
    assert.equal(list.items[0].latest_published_version, 1);
    assert.equal(list.items[0].draft_version, 2);
    assert.equal(list.meta.total, 1);
  });
});

describe('MarketingTemplatesService — content validation', () => {
  it('rejects unknown template variables', async () => {
    const { service } = makeService([makeTemplateRow()]);
    await assert.rejects(
      service.create(ACTOR, {
        name: 'Welcome email',
        slug: 'welcome-email',
        content: {
          ...VALID_CONTENT,
          subject: 'Hi {{school_name}} and {{recipient_name}}',
          allowed_variables: [{ name: 'school_name', required: true }],
        },
      }),
      (error: { getStatus?: () => number; getResponse?: () => unknown }) => {
        assert.equal(error.getStatus?.(), 400);
        assert.match(JSON.stringify(error.getResponse?.()), /recipient_name/);
        return true;
      },
    );
  });

  it('rejects duplicate allowed-variable names', async () => {
    const { service } = makeService([makeTemplateRow()]);
    await assert.rejects(
      service.saveContent(ACTOR, TEMPLATE_ID, {
        ...VALID_CONTENT,
        allowed_variables: [
          { name: 'school_name', required: true },
          { name: 'school_name', required: false },
        ],
      }),
      BadRequestException,
    );
  });

  it('rejects unsafe HTML (script, iframe, form, handlers, unsafe URLs)', async () => {
    for (const html of [
      '<p>ok</p><script>alert(1)</script>',
      '<p>ok</p><iframe src="https://evil.example"></iframe>',
      '<form action="https://evil.example"><input name="a"></form>',
      '<p onclick="alert(1)">ok</p>',
      '<a href="javascript:alert(1)">x</a>',
    ]) {
      const { service } = makeService([makeTemplateRow()]);
      await assert.rejects(
        service.saveContent(ACTOR, TEMPLATE_ID, { ...VALID_CONTENT, html_body: html }),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 400, html);
          return true;
        },
      );
    }
  });

  it('sanitizes benign-but-unknown markup instead of rejecting it', async () => {
    const { service, repos } = makeService([makeTemplateRow()]);
    await service.saveContent(ACTOR, TEMPLATE_ID, {
      ...VALID_CONTENT,
      html_body: '<marquee>Hi {{school_name}}</marquee><p style="color:red">x</p>',
    });
    const stored = repos.versionRows[0];
    assert.ok(!stored.html_body.includes('marquee'));
    assert.ok(!stored.html_body.includes('style'));
    assert.ok(stored.html_body.includes('Hi {{school_name}}'));
  });
});

describe('MarketingTemplatesService — preview & test send', () => {
  it('renders a preview with sample variables, escaping HTML values', async () => {
    const { service } = makeService(
      [makeTemplateRow()],
      [
        makeVersionRow(TEMPLATE_ID, {
          id: VERSION_1,
          subject: 'Hello {{school_name}}',
          html_body: '<p>Hello {{school_name}}</p>',
          text_body: 'Hello {{school_name}}',
        }),
      ],
    );

    const preview = await service.preview(TEMPLATE_ID, {
      variables: { school_name: '<b>Lincoln</b> High' },
    });
    assert.equal(preview.subject, 'Hello <b>Lincoln</b> High');
    assert.equal(preview.html_body, '<p>Hello &lt;b&gt;Lincoln&lt;/b&gt; High</p>');
    assert.equal(preview.text_body, 'Hello <b>Lincoln</b> High');
  });

  it('falls back to the declared example values, leaving placeholders for the rest', async () => {
    const { service } = makeService(
      [makeTemplateRow()],
      [
        makeVersionRow(TEMPLATE_ID, {
          id: VERSION_1,
          subject: 'Hello {{school_name}} {{missing_var}}',
        }),
      ],
    );
    const preview = await service.preview(TEMPLATE_ID, {});
    assert.ok(preview.subject.includes('Lincoln High'), 'example value fills in');
    assert.ok(preview.subject.includes('{{missing_var}}'), 'undeclared placeholder stays');
  });

  it('sends a test email only to the configured recipients — never an address from the body', async () => {
    const { service, sent } = makeService(
      [makeTemplateRow()],
      [makeVersionRow(TEMPLATE_ID, { id: VERSION_1 })],
      { testRecipients: ['zeromilesystems@gmail.com'] },
    );

    const result = await service.testSendVersion(TEMPLATE_ID, {
      version_id: VERSION_1,
      // A hostile client tries to steer the recipient — there is no field.
      variables: { school_name: 'Lincoln' },
    } as never);

    assert.equal(result.sent, true);
    assert.equal(result.recipient_count, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'zeromilesystems@gmail.com');
  });

  it('refuses a test send when no test recipients are configured', async () => {
    const { service } = makeService(
      [makeTemplateRow()],
      [makeVersionRow(TEMPLATE_ID, { id: VERSION_1 })],
      { testRecipients: [] },
    );
    await assert.rejects(
      service.testSendVersion(TEMPLATE_ID, {}),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 503);
        return true;
      },
    );
  });
});
