import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Sequelize } from 'sequelize-typescript';

import {
  EmailCampaign,
  EmailCampaignRecipient,
  EmailEvent,
  EmailTemplate,
  EmailTemplateVersion,
  MarketingAttribution,
  MarketingLead,
  MarketingLeadEvent,
  MarketingDeliverySettings,
  MarketingNotificationJob,
  MarketingProviderEvent,
  MarketingSuppression,
  models,
} from './models';
import {
  MARKETING_CAMPAIGN_STATUS_VALUES,
  MARKETING_ERROR_CATEGORY_VALUES,
  MARKETING_EVENT_TYPE_VALUES,
  MARKETING_LEAD_EVENT_TYPE_VALUES,
  MARKETING_LEAD_SOURCE_VALUES,
  MARKETING_LEAD_STATUS_VALUES,
  MARKETING_RECIPIENT_SOURCE_VALUES,
  MARKETING_RECIPIENT_STATUS_VALUES,
  MARKETING_SUPPRESSION_REASON_VALUES,
  MARKETING_SUPPRESSION_SOURCE_VALUES,
  MARKETING_TEMPLATE_STATUS_VALUES,
} from './models';
import {
  MarketingCampaignStatus,
  MarketingErrorCategory,
  MarketingEventType,
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  MarketingRecipientSource,
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
  MarketingTemplateStatus,
} from '@school-bus-tracking/shared-types';

/**
 * Marketing model registry and shape — checked **without a database**.
 *
 * `new Sequelize({ models })` initializes the decorators (it opens no
 * connection — the constructor never dials out), which is what makes the
 * model classes introspectable here. What this spec pins:
 *
 * - every marketing model is registered in the single `models` registry the
 *   database bootstrap uses, exactly once;
 * - the physical table names match the migrations;
 * - the recipient model cannot leak a token digest (default scope + toJSON);
 * - the immutable-version and snapshot constraints exist at the model level;
 * - the enum value arrays re-exported to the API layer match the shared
 *   enums exactly, so database, API and clients cannot drift.
 */

/** Declared index names of a model (the decorator-populated `options.indexes`). */
function indexNames(model: unknown): string[] {
  const indexes = (model as { options?: { indexes?: Array<{ name?: string }> } }).options?.indexes;
  return (indexes ?? []).map((index) => String(index.name));
}

const marketingModels = [
  ['EmailTemplate', EmailTemplate, 'email_templates'],
  ['EmailTemplateVersion', EmailTemplateVersion, 'email_template_versions'],
  ['EmailCampaign', EmailCampaign, 'email_campaigns'],
  ['EmailCampaignRecipient', EmailCampaignRecipient, 'email_campaign_recipients'],
  ['EmailEvent', EmailEvent, 'email_events'],
  ['MarketingSuppression', MarketingSuppression, 'marketing_suppressions'],
  ['MarketingLead', MarketingLead, 'marketing_leads'],
  ['MarketingLeadEvent', MarketingLeadEvent, 'marketing_lead_events'],
  ['MarketingDeliverySettings', MarketingDeliverySettings, 'marketing_delivery_settings'],
  ['MarketingNotificationJob', MarketingNotificationJob, 'marketing_notification_jobs'],
  ['MarketingProviderEvent', MarketingProviderEvent, 'marketing_provider_events'],
  ['MarketingAttribution', MarketingAttribution, 'marketing_attributions'],
] as const;

// Initialize the decorator metadata once for this spec file (no connection).
new Sequelize({ dialect: 'postgres', models: [...models], logging: false });

describe('marketing model registry', () => {
  it('registers every marketing model in the bootstrap registry exactly once', () => {
    for (const [name] of marketingModels) {
      const count = models.filter((model) => model.name === name).length;
      assert.equal(count, 1, `${name} must appear exactly once in the models registry`);
    }
  });

  it('maps every marketing model to the migration-created table', () => {
    for (const [name, model, table] of marketingModels) {
      const actual =
        (model.getTableName() as { tableName?: string }).tableName ?? model.getTableName();
      assert.equal(actual, table, `${name} must map to ${table}`);
    }
  });

  it('keeps the complete model registry intentional and duplicate-free', () => {
    const registeredModelNames = models.map((model) => model.name).sort();

    assert.deepEqual(registeredModelNames, [
      'AssistedManagementSession',
      'AuditLog',
      'Bus',
      'BusDocument',
      'CrewPairingToken',
      'DeviceToken',
      'DocumentRequirement',
      'DriverDocument',
      'EmailCampaign',
      'EmailCampaignRecipient',
      'EmailEvent',
      'EmailTemplate',
      'EmailTemplateVersion',
      'EmergencyEvent',
      'IdempotencyKey',
      'ImportJob',
      'MarketingAttribution',
      'MarketingDeliverySettings',
      'MarketingLead',
      'MarketingLeadEvent',
      'MarketingNotificationJob',
      'MarketingProviderEvent',
      'MarketingSuppression',
      'Notification',
      'PasswordResetToken',
      'Plan',
      'RefreshToken',
      'Route',
      'RouteAssignment',
      'RouteGeometry',
      'Run',
      'RunCrew',
      'School',
      'SchoolSubscription',
      'Shift',
      'Stop',
      'Student',
      'StudentGuardian',
      'Trip',
      'TripLocation',
      'TripStopArrival',
      'TripStudentAttendance',
      'User',
    ]);
  });
});

describe('EmailCampaignRecipient — token hygiene', () => {
  it('excludes both token digests from the default scope', () => {
    const scope = (
      EmailCampaignRecipient as unknown as {
        _scope: { attributes?: { exclude?: string[] } };
      }
    )._scope;
    assert.ok(scope?.attributes?.exclude, 'a default scope with excludes must exist');
    assert.ok(scope.attributes.exclude.includes('click_token_hash'));
    assert.ok(scope.attributes.exclude.includes('unsubscribe_token_hash'));
  });

  it('strips both digests in toJSON even when a query opted out of the scope', () => {
    const row = EmailCampaignRecipient.build({
      campaign_id: '00000000-0000-4000-8000-000000000001',
      school_id: null,
      normalized_email: 'principal@school.example',
      recipient_source: MarketingRecipientSource.SCHOOL_EMAIL,
      status: MarketingRecipientStatus.SENT,
      attempts: 1,
      click_token_hash: 'a'.repeat(64),
      unsubscribe_token_hash: 'b'.repeat(64),
    } as never);

    const json = row.toJSON() as Record<string, unknown>;
    assert.equal('click_token_hash' in json, false);
    assert.equal('unsubscribe_token_hash' in json, false);
    assert.equal(json.normalized_email, 'principal@school.example');
  });

  it('declares unique indexes for both digests and the campaign/email pair', () => {
    const names = indexNames(EmailCampaignRecipient);
    for (const expected of [
      'uq_email_campaign_recipients_campaign_email',
      'uq_email_campaign_recipients_click_token',
      'uq_email_campaign_recipients_unsubscribe_token',
      'idx_email_campaign_recipients_status_next',
    ]) {
      assert.ok(names.includes(expected), `${expected} must be declared on the model`);
    }
  });
});

describe('EmailTemplateVersion — immutability supports', () => {
  it('declares the unique (template_id, version) index', () => {
    const names = indexNames(EmailTemplateVersion);
    assert.ok(names.includes('uq_email_template_versions_template_version'));
  });

  it('carries a nullable published_at with no default (NULL = still a draft)', () => {
    const attribute = EmailTemplateVersion.rawAttributes.published_at;
    assert.ok(attribute, 'published_at must exist on the model');
    assert.equal(attribute.defaultValue, undefined);
  });
});

describe('append-only models', () => {
  it('disables updatedAt and deletedAt on email events and lead events', () => {
    for (const model of [EmailEvent, MarketingLeadEvent]) {
      assert.equal(model.options.timestamps, true, 'created_at is still written');
      assert.equal(model.options.updatedAt, false, `${model.name} must not track updated_at`);
      assert.equal(model.options.deletedAt, false, `${model.name} must not soft delete`);
      assert.equal(model.options.paranoid, false);
    }
  });

  it('disables soft delete on recipients and suppressions', () => {
    for (const model of [EmailCampaignRecipient, MarketingSuppression]) {
      assert.equal(model.options.deletedAt, false, `${model.name} must not soft delete`);
    }
  });
});

describe('EmailCampaign — scheduling shape', () => {
  it('declares the due-campaign scan index', () => {
    const names = indexNames(EmailCampaign);
    assert.ok(names.includes('idx_email_campaigns_status_scheduled'));
  });

  it('defaults to DRAFT with zeroed counters', () => {
    const attributes = EmailCampaign.rawAttributes;
    assert.equal(attributes.status.defaultValue, MarketingCampaignStatus.DRAFT);
    for (const column of [
      'recipient_count',
      'sent_count',
      'failed_count',
      'clicked_count',
      'unsubscribed_count',
    ]) {
      assert.equal(attributes[column].defaultValue, 0);
    }
  });
});

describe('marketing enum value arrays match the shared enums', () => {
  const pairs: Array<[string, readonly string[], readonly string[]]> = [
    [
      'MARKETING_TEMPLATE_STATUS_VALUES',
      MARKETING_TEMPLATE_STATUS_VALUES,
      Object.values(MarketingTemplateStatus),
    ],
    [
      'MARKETING_CAMPAIGN_STATUS_VALUES',
      MARKETING_CAMPAIGN_STATUS_VALUES,
      Object.values(MarketingCampaignStatus),
    ],
    [
      'MARKETING_RECIPIENT_STATUS_VALUES',
      MARKETING_RECIPIENT_STATUS_VALUES,
      Object.values(MarketingRecipientStatus),
    ],
    ['MARKETING_EVENT_TYPE_VALUES', MARKETING_EVENT_TYPE_VALUES, Object.values(MarketingEventType)],
    [
      'MARKETING_ERROR_CATEGORY_VALUES',
      MARKETING_ERROR_CATEGORY_VALUES,
      Object.values(MarketingErrorCategory),
    ],
    [
      'MARKETING_RECIPIENT_SOURCE_VALUES',
      MARKETING_RECIPIENT_SOURCE_VALUES,
      Object.values(MarketingRecipientSource),
    ],
    [
      'MARKETING_SUPPRESSION_REASON_VALUES',
      MARKETING_SUPPRESSION_REASON_VALUES,
      Object.values(MarketingSuppressionReason),
    ],
    [
      'MARKETING_SUPPRESSION_SOURCE_VALUES',
      MARKETING_SUPPRESSION_SOURCE_VALUES,
      Object.values(MarketingSuppressionSource),
    ],
    [
      'MARKETING_LEAD_STATUS_VALUES',
      MARKETING_LEAD_STATUS_VALUES,
      Object.values(MarketingLeadStatus),
    ],
    [
      'MARKETING_LEAD_SOURCE_VALUES',
      MARKETING_LEAD_SOURCE_VALUES,
      Object.values(MarketingLeadSource),
    ],
    [
      'MARKETING_LEAD_EVENT_TYPE_VALUES',
      MARKETING_LEAD_EVENT_TYPE_VALUES,
      Object.values(MarketingLeadEventType),
    ],
  ];

  for (const [name, exported, shared] of pairs) {
    it(`${name} equals the shared-types enum values`, () => {
      assert.deepEqual([...exported], [...shared]);
    });
  }
});
