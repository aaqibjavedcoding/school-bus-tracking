import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserRole } from '@school-bus-tracking/shared-types';
import { canAccessPath, navItemsForRole } from '../../lib/roles.ts';

/**
 * Structural guarantees of the marketing console pages.
 *
 * These assertions read the page sources rather than render them: the pages
 * are client components wired to Next's router, but the properties that
 * matter here are static and are exactly the ones a refactor tends to break
 * silently — a page reaching for `fetch` instead of the shared apiClient, or
 * a "send test email" control growing a recipient field.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const MARKETING_DIR = path.resolve(here, '..', '..', 'app', '(authenticated)', 'admin', 'marketing');

const PAGES = {
  templateList: path.join(MARKETING_DIR, 'templates', 'page.tsx'),
  templateCreate: path.join(MARKETING_DIR, 'templates', 'new', 'page.tsx'),
  templateDetail: path.join(MARKETING_DIR, 'templates', '[id]', 'page.tsx'),
  campaignList: path.join(MARKETING_DIR, 'campaigns', 'page.tsx'),
  campaignCreate: path.join(MARKETING_DIR, 'campaigns', 'new', 'page.tsx'),
  campaignDetail: path.join(MARKETING_DIR, 'campaigns', '[id]', 'page.tsx'),
  leadList: path.join(MARKETING_DIR, 'leads', 'page.tsx'),
  leadDetail: path.join(MARKETING_DIR, 'leads', '[id]', 'page.tsx'),
  suppressions: path.join(MARKETING_DIR, 'suppressions', 'page.tsx'),
};

const DEMO_REQUEST_FORM = path.resolve(here, '..', '..', 'app', 'DemoRequestForm.tsx');
const LANDING_PAGE = path.resolve(here, '..', '..', 'app', 'page.tsx');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('marketing console navigation', () => {
  it('exposes template and campaign entries to SUPER_ADMIN only', () => {
    const superAdmin = navItemsForRole(UserRole.SUPER_ADMIN).map((item) => item.href);
    assert.ok(superAdmin.includes('/admin/marketing/templates'), 'templates are reachable');
    assert.ok(superAdmin.includes('/admin/marketing/campaigns'), 'campaigns are reachable');

    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const hrefs = navItemsForRole(role).map((item) => item.href);
      assert.ok(
        !hrefs.some((href) => href.startsWith('/admin/marketing')),
        `${role} sees no marketing nav entry`,
      );
      assert.equal(canAccessPath(role, '/admin/marketing/templates'), false);
      assert.equal(canAccessPath(role, '/admin/marketing/campaigns'), false);
    }

    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/admin/marketing/templates'), true);
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/admin/marketing/campaigns'), true);
  });

  it('backs every marketing nav entry with an App Router page', () => {
    assert.ok(fs.existsSync(PAGES.templateList));
    assert.ok(fs.existsSync(PAGES.campaignList));
  });
});

describe('marketing pages use the shared API client', () => {
  for (const [name, file] of Object.entries(PAGES)) {
    it(`${name} never calls fetch directly`, () => {
      const source = read(file);
      assert.ok(
        !/\bfetch\s*\(/.test(source),
        'pages must go through apiClient so auth refresh, CSRF and error envelopes are handled once',
      );
      assert.match(source, /from '(\.\.\/)+services\/api'/);
    });
  }
});

describe('template pages', () => {
  it('offers a test send that cannot target an arbitrary address', () => {
    const source = read(PAGES.templateDetail);
    assert.match(source, /testSendMarketingTemplateVersion\(templateId, selected\.id, \{\}\)/);
    assert.match(source, /MARKETING_TEST_SEND_NOTE/);
    assert.ok(
      !/id="[^"]*recipient/i.test(source),
      'no form control collects a test recipient',
    );
    assert.ok(
      !/test(Recipient|Email|Address)\b/i.test(source),
      'the page holds no test-address state of its own',
    );
  });

  it('covers loading, error and empty states on the list', () => {
    const source = read(PAGES.templateList);
    assert.match(source, /<Skeleton/);
    assert.match(source, /<ErrorState/);
    assert.match(source, /<EmptyState/);
  });

  it('confirms before archiving and publishes an immutable version', () => {
    const source = read(PAGES.templateDetail);
    assert.match(source, /<ConfirmDialog/);
    assert.match(source, /publishMarketingTemplateVersion/);
    assert.match(source, /canPublishTemplateVersion/);
  });

  it('renders the HTML preview inside a sandboxed frame', () => {
    const source = read(PAGES.templateDetail);
    assert.match(source, /sandbox=""/);
    assert.ok(
      !/dangerouslySetInnerHTML/.test(source),
      'a preview never injects rendered email HTML into the console origin',
    );
  });
});

describe('campaign pages', () => {
  it('shows progress segments and counters from the shared helpers', () => {
    const detail = read(PAGES.campaignDetail);
    assert.match(detail, /campaignProgressSegments/);
    assert.match(detail, /campaignCompletionPercent/);
    assert.match(detail, /unsubscribed_count/);
    assert.match(detail, /total_click_count/);
    assert.match(detail, /describeGradualDelivery/);
  });

  it('gates pause, resume and cancel behind the lifecycle helpers', () => {
    const detail = read(PAGES.campaignDetail);
    for (const guard of ['canPauseCampaign', 'canResumeCampaign', 'canCancelCampaign']) {
      assert.match(detail, new RegExp(guard));
    }
    assert.match(detail, /pauseMarketingCampaign/);
    assert.match(detail, /resumeMarketingCampaign/);
    assert.match(detail, /cancelMarketingCampaign/);
    assert.match(detail, /<ConfirmDialog/, 'cancelling is confirmed first');
  });

  it('only lets a campaign pin a published template version', () => {
    const create = read(PAGES.campaignCreate);
    assert.match(create, /published_at !== null/);
    assert.match(create, /previewMarketingAudience/);
    assert.match(create, /masked_email/);
  });

  it('covers loading, error and empty states on the list', () => {
    const source = read(PAGES.campaignList);
    assert.match(source, /<Skeleton/);
    assert.match(source, /<ErrorState/);
    assert.match(source, /<EmptyState/);
  });
});

describe('demo lead pages (Session 4)', () => {
  it('exposes the leads console to SUPER_ADMIN only', () => {
    const superAdmin = navItemsForRole(UserRole.SUPER_ADMIN).map((item) => item.href);
    assert.ok(superAdmin.includes('/admin/marketing/leads'), 'leads are reachable');
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/admin/marketing/leads'), true);

    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const hrefs = navItemsForRole(role).map((item) => item.href);
      assert.ok(!hrefs.includes('/admin/marketing/leads'), `${role} sees no leads entry`);
      assert.equal(canAccessPath(role, '/admin/marketing/leads'), false);
    }
    assert.ok(fs.existsSync(PAGES.leadList));
    assert.ok(fs.existsSync(PAGES.leadDetail));
  });

  it('the list masks follow-up details — phone, message and contact time live on the detail page', () => {
    const source = read(PAGES.leadList);
    assert.ok(!/lead\.phone/.test(source), 'no phone column in the list');
    assert.ok(!/lead\.message/.test(source), 'no message column in the list');
    assert.ok(!/preferred_contact_time/.test(source));
  });

  it('offers search, status/source filters, a date range and pagination', () => {
    const source = read(PAGES.leadList);
    assert.match(source, /SearchInput/);
    assert.match(source, /type="date"/);
    assert.match(source, /<Pagination/);
    assert.match(source, /marketingLeadStatusLabel/);
    assert.match(source, /marketingLeadSourceLabel/);
  });

  it('the detail page words DEMO_SCHEDULED as a really confirmed appointment', () => {
    const source = read(PAGES.leadDetail);
    assert.match(source, /appointment was confirmed/);
    assert.match(source, /marketingLeadNextStatuses/, 'buttons mirror the server graph');
    assert.match(source, /describeLeadEvent/, 'the timeline uses the shared wording');
  });

  it('the detail page carries the forwarded-email attribution caveat', () => {
    const source = read(PAGES.leadDetail);
    assert.match(source, /forwarded/);
  });

  it('covers loading, error and empty states on the list', () => {
    const source = read(PAGES.leadList);
    assert.match(source, /<Skeleton/);
    assert.match(source, /<ErrorState/);
    assert.match(source, /<EmptyState/);
  });
});

describe('public demo request form (landing page)', () => {
  it('is wired into the landing page with an accessible section', () => {
    const landing = read(LANDING_PAGE);
    assert.match(landing, /DemoRequestForm/);
    assert.match(landing, /id="request-demo"/);
    assert.match(landing, /Request a Demo/);
  });

  it('submits through the shared apiClient, never raw fetch', () => {
    const source = read(DEMO_REQUEST_FORM);
    assert.ok(!/\bfetch\s*\(/.test(source));
    assert.match(source, /submitMarketingDemoRequest/);
  });

  it('renders the honeypot and a consent checkbox, and no campaign/school/recipient id field', () => {
    const source = read(DEMO_REQUEST_FORM);
    assert.match(source, /name="website"/, 'the honeypot field the server checks first');
    assert.match(source, /tabIndex=\{-1\}/, 'keyboard users never land in the honeypot');
    assert.match(source, /type="checkbox"/, 'explicit consent');
    for (const forbidden of ['campaign_id', 'school_id', 'recipient_id', 'admin_email']) {
      assert.ok(
        !source.includes(forbidden),
        `the form never collects or submits ${forbidden} — attribution rides on the HttpOnly cookie`,
      );
    }
  });

  it('promises a follow-up, never a booked appointment', () => {
    const source = read(DEMO_REQUEST_FORM);
    assert.match(source, /Nothing is\s+booked yet/);
    assert.ok(!/instantly scheduled|booking confirmed/i.test(source));
  });

  it('captures only allowlisted utm_ parameters', () => {
    const source = read(DEMO_REQUEST_FORM);
    assert.match(source, /utm_source/);
    assert.match(source, /UTM_KEYS/);
    assert.ok(!/searchParams\.entries|params\.entries/.test(source), 'no blanket query capture');
  });
});

describe('suppressions console (Hardening 5B)', () => {
  it('exposes the suppression list to SUPER_ADMIN only', () => {
    const superAdmin = navItemsForRole(UserRole.SUPER_ADMIN).map((item) => item.href);
    assert.ok(superAdmin.includes('/admin/marketing/suppressions'));
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/admin/marketing/suppressions'), true);

    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const hrefs = navItemsForRole(role).map((item) => item.href);
      assert.ok(!hrefs.includes('/admin/marketing/suppressions'));
      assert.equal(canAccessPath(role, '/admin/marketing/suppressions'), false);
    }
    assert.ok(fs.existsSync(PAGES.suppressions));
  });

  it('renders masked addresses and never a raw recipient address', () => {
    const source = read(PAGES.suppressions);
    assert.match(source, /item\.masked_email/);
    assert.ok(
      !/item\.normalized_email|item\.email\b/.test(source),
      'the API returns no full address and the page must not invent one',
    );
  });

  it('is honest about the Gmail SMTP limitation instead of implying a webhook', () => {
    const source = read(PAGES.suppressions);
    assert.match(source, /Gmail SMTP/);
    assert.match(source, /no webhook/i);
    assert.ok(
      !/automatically (processes|handles) (bounces|complaints)/i.test(source),
      'the page never claims automatic bounce processing',
    );
  });

  it('confirms before removing, with a second gate for an unsubscribe', () => {
    const source = read(PAGES.suppressions);
    assert.match(source, /<ConfirmDialog/);
    assert.match(source, /acknowledge_unsubscribed/);
    assert.match(source, /acknowledgeUnsubscribed/);
  });

  it('never offers UNSUBSCRIBED as a manual reason', () => {
    const source = read(PAGES.suppressions);
    const manualBlock = source.slice(
      source.indexOf('MANUAL_REASON_OPTIONS'),
      source.indexOf('export default'),
    );
    assert.ok(
      !manualBlock.includes('MarketingSuppressionReason.UNSUBSCRIBED'),
      'an operator cannot assert an opt-out on someone else\'s behalf',
    );
  });

  it('goes through the shared apiClient with search, filter and pagination', () => {
    const source = read(PAGES.suppressions);
    assert.ok(!/\bfetch\s*\(/.test(source));
    assert.match(source, /listMarketingSuppressions/);
    assert.match(source, /createMarketingSuppression/);
    assert.match(source, /deleteMarketingSuppression/);
    assert.match(source, /<Pagination/);
    assert.match(source, /<Skeleton/);
    assert.match(source, /<ErrorState/);
    assert.match(source, /<EmptyState/);
  });
});

describe('lead erasure control (Hardening 5B)', () => {
  it('requires the operator to retype the lead name before erasing', () => {
    const source = read(PAGES.leadDetail);
    assert.match(source, /canEraseMarketingLead/);
    assert.match(source, /eraseMarketingLead\(leadId, \{ confirm: true \}\)/);
    assert.match(source, /Irreversible/);
  });

  it('describes erasure as anonymization that keeps the consent record', () => {
    const source = read(PAGES.leadDetail);
    assert.match(source, /consent record/i);
  });
});
