import { test, expect } from '@playwright/test';

/**
 * Component-isolation visual baselines for EmptyState + Skeleton (Tier 2 — VIS-5).
 *
 * Screenshots the static Storybook build directly via /iframe.html?id=... (the
 * single-story render Storybook itself uses) — no live dev server needed in CI.
 *
 * Story id = "<title-kebab>--<export-name>", e.g. title 'Components/EmptyState' +
 * export `WithAction` -> 'components-emptystate--with-action'.
 */
const stories = [
  { id: 'components-emptystate--with-action', name: 'emptystate-with-action' },
  { id: 'components-emptystate--without-action', name: 'emptystate-without-action' },
  { id: 'components-skeleton--single-row', name: 'skeleton-single-row' },
  { id: 'components-skeleton--list', name: 'skeleton-list' },
];

for (const s of stories) {
  test(`story: ${s.id}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${s.id}&viewMode=story`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${s.name}.png`);
  });
}

// i18n-decorator regression check (AC): Skeleton's visually-hidden loading label
// must resolve to real English copy via the Storybook preview's i18n init, not
// render the raw `common.loading` translation key.
test('skeleton loading text is localized, not the raw key', async ({ page }) => {
  await page.goto('/iframe.html?id=components-skeleton--single-row&viewMode=story');
  await page.waitForLoadState('networkidle');
  const status = page.getByRole('status');
  await expect(status).toContainText('Loading…');
  await expect(status).not.toContainText('common.loading');
});
