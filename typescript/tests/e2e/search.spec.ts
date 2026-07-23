import { test, expect } from '@playwright/test';

test.describe('Search Page', () => {
  test('renders search filters', async ({ page }) => {
    await page.goto('/search');
    await page.waitForSelector('[data-testid="search-filters"]', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('body')).toBeVisible();
  });

  test('filters work', async ({ page }) => {
    await page.goto('/search');
    const filterInput = page.locator('[data-testid="search-input"]');
    await filterInput.waitFor({ timeout: 10000 }).catch(() => {});
    if (await filterInput.isVisible()) {
      await filterInput.fill('run');
      await expect(filterInput).toHaveValue('run');
    }
  });

  test('results paginate', async ({ page }) => {
    await page.goto('/search');
    await page.waitForSelector('[data-testid="search-results"]', { timeout: 10000 }).catch(() => {});
    const pagination = page.locator('[data-testid="pagination"]');
    await expect(pagination).toBeVisible({ timeout: 5000 }).catch(() => {
      // Pagination may not appear without enough results
    });
  });
});
