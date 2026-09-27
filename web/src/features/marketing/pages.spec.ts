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
};

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
