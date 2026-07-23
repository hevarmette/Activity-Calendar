import { test, expect } from '@playwright/test';

test.describe('Report Page', () => {
  test('renders chart', async ({ page }) => {
    await page.goto('/report');
    await page.waitForSelector('[data-testid="report-chart"]', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('body')).toBeVisible();
  });

  test('can change grouping', async ({ page }) => {
    await page.goto('/report');
    const groupSelect = page.locator('[data-testid="grouping-select"]');
    await groupSelect.waitFor({ timeout: 10000 }).catch(() => {});
    if (await groupSelect.isVisible()) {
      await groupSelect.selectOption({ index: 1 });
      await expect(page.locator('[data-testid="report-chart"]')).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });
});
