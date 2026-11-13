import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('shows embedded build information under offline CSP and opens only clicked links', async ({
  page,
  context,
}, info) => {
  const identity: unknown = JSON.parse(await readFile('dist/app/build-info.json', 'utf8'));
  if (
    typeof identity !== 'object' ||
    identity === null ||
    !('commit' in identity) ||
    typeof identity.commit !== 'string'
  ) {
    throw new Error('Missing build identity');
  }
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /connect-src 'none'/,
  );
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(identity.commit);
  await expect(dialog.getByRole('link', { name: 'Audacity', exact: true })).toBeVisible();
  expect(requests.some((url) => url.includes('build-info.json'))).toBe(false);
  expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath('about.png'),
    fullPage: true,
    animations: 'disabled',
  });
  // Intercept the destination: this checks navigation without contacting the credit site.
  await context.route('https://www.audacityteam.org/', (route) =>
    route.fulfill({ body: '<title>Credit destination</title>' }),
  );
  const opening = context.waitForEvent('page');
  await dialog.getByRole('link', { name: 'Audacity', exact: true }).click();
  const external = await opening;
  await external.waitForLoadState();
  expect(external.url()).toBe('https://www.audacityteam.org/');
  expect(await external.evaluate(() => window.opener === null)).toBe(true);
  await external.close();
  await expect(dialog).toBeVisible();
});
