/**
 * SUPER_ADMIN lead erasure — the right-to-erasure action for a demo lead.
 *
 * ### Anonymize, do not delete
 *
 * A lead row carries two very different things: **personal data** (name,
 * address, phone, free-text message, UTM) and **evidence** (that consent was
 * given, when, through which channel, and how the pipeline treated it).
 * Deleting the row destroys the evidence the same request is meant to prove
 * was handled; keeping the row intact ignores the request. So erasure
 * overwrites every identifying field, strips the metadata of the lead's
 * timeline events, and stamps `erased_at`. What remains is a dated, empty
 * shell: "a lead existed, consented on this date, reached this status, and
 * was erased".
 *
 * ### Rules
 *
 * - **Confirmation is mandatory** and checked server-side; the console's
 *   dialog is a courtesy, not the gate.
 * - **Idempotent.** `erased_at` short-circuits a second run, so a retried
 *   click cannot double-count or throw.
 * - **The audit record carries safe metadata only** — the lead id, counts,
 *   and the fact of erasure. Never the erased email, phone or message: an
 *   audit log that quotes what was erased has not erased anything.
 * - **Pending notification jobs are closed**, not deleted: an EXPIRED job
 *   keeps the queue honest and stops a worker from mailing an operator the
 *   details of a lead that was just erased.
 */

import { Op } from 'sequelize';
import {
  MarketingLeadEventType,
  MarketingNotificationJobStatus,
  type MarketingLeadErasureResponse,
} from '@school-bus-tracking/shared-types';
import { BadRequestException, Logger, NotFoundException } from '../../framework';
import type {
  MarketingLead,
  MarketingLeadEvent,
  MarketingNotificationJob,
} from '../../database/models';
import {
  MARKETING_LEAD_ERASED_MESSAGE,
  MARKETING_LEAD_ERASE_CONFIRM_REQUIRED,
  MARKETING_LEAD_NOT_FOUND,
} from './marketing.constants';

export interface MarketingErasureServiceDeps {
  leads: typeof MarketingLead;
  events: typeof MarketingLeadEvent;
  notificationJobs: typeof MarketingNotificationJob;
  now?: () => Date;
}

/** Placeholder written over an erased name. */
export const MARKETING_ERASED_NAME = '[erased]';

/** Non-routable placeholder address (RFC 2606 `.invalid`). */
export function erasedLeadEmail(leadId: string): string {
  return `erased-${leadId}@invalid`;
}

export class MarketingErasureService {
  private readonly logger = new Logger(MarketingErasureService.name);
  private readonly now: () => Date;

  constructor(private readonly deps: MarketingErasureServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async eraseLead(leadId: string, confirm: boolean): Promise<MarketingLeadErasureResponse> {
    if (confirm !== true) {
      throw new BadRequestException(MARKETING_LEAD_ERASE_CONFIRM_REQUIRED);
    }
    const lead = await this.deps.leads.findOne({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException(MARKETING_LEAD_NOT_FOUND);
    }
    if (lead.erased_at) {
      // Idempotent: nothing left to erase, and no error for a double click.
      return {
        lead_id: lead.id,
        erased: true,
        events_anonymized: 0,
        message: MARKETING_LEAD_ERASED_MESSAGE,
      };
    }

    const erasedAt = this.now();
    await lead.update({
      full_name: MARKETING_ERASED_NAME,
      normalized_email: erasedLeadEmail(lead.id),
      institution_name: null,
      phone: null,
      city: null,
      country: null,
      message: null,
      preferred_contact_time: null,
      utm: null,
      submission_fingerprint: null,
      erased_at: erasedAt,
    } as never);

    // Timeline events keep their type and timestamp (the pipeline history)
    // but lose their metadata, which is where notes and free text live.
    const [eventsAnonymized] = await this.deps.events.update(
      { metadata: null } as never,
      {
        where: {
          lead_id: lead.id,
          metadata: { [Op.ne]: null },
        } as never,
      },
    );

    // Close any notification still owed for this lead — nobody should be
    // emailed the contact details of a lead that was just erased.
    try {
      await this.deps.notificationJobs.update(
        {
          status: MarketingNotificationJobStatus.EXPIRED,
          locked_by: null,
          lease_expires_at: null,
        } as never,
        {
          where: {
            lead_id: lead.id,
            status: {
              [Op.in]: [
                MarketingNotificationJobStatus.PENDING,
                MarketingNotificationJobStatus.RETRYING,
                MarketingNotificationJobStatus.PROCESSING,
              ],
            },
          } as never,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not close notification jobs for an erased lead: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    // One timeline entry proving the erasure happened — with no content.
    try {
      await this.deps.events.create({
        lead_id: lead.id,
        event_type: MarketingLeadEventType.STATUS_CHANGED,
        actor: 'super-admin',
        metadata: { action: 'erased' },
      } as never);
    } catch (error) {
      this.logger.warn(
        `Could not record the erasure event: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return {
      lead_id: lead.id,
      erased: true,
      events_anonymized: eventsAnonymized ?? 0,
      message: MARKETING_LEAD_ERASED_MESSAGE,
    };
  }
}
