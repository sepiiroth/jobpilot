import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const credentials = async () =>
  JSON.parse(await readFile('.pnpm-store/e2e-runtime.json', 'utf8'));
test('login, collect, review documents and track an application with keyboard and mobile support', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
  await mkdir('docs/screenshots', { recursive: true });
  await page.goto('/candidatures');
  await expect(page).toHaveURL(/\/connexion$/);
  await page.screenshot({ path: 'docs/screenshots/login.png' });
  const account = await credentials();
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page
    .getByRole('button', { name: 'Lancer la collecte', exact: true })
    .click();
  await expect(
    page.getByText('Collecte terminée.', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: 'docs/screenshots/dashboard.png' });
  await page.getByRole('link', { name: 'Offres', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Développeuse TypeScript', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('92 / 100', { exact: true })).toBeVisible();
  await page
    .getByRole('link', { name: 'Développeuse TypeScript', exact: true })
    .click();
  const masters = await page.evaluate(() =>
    fetch('http://localhost:3001/resumes', { credentials: 'include' }).then(
      (response) => response.json(),
    ),
  );
  const generated = (kind) =>
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/jobs\/[^/]+\/documents$/.test(new URL(response.url()).pathname) &&
        response.request().postDataJSON().kind === kind,
    );
  const [cvResponse, letterResponse] = await Promise.all([
    generated('resume'),
    generated('cover_letter'),
    page
      .getByRole('button', { name: 'Générer CV et lettre', exact: true })
      .click(),
  ]);
  expect(cvResponse.status()).toBe(200);
  expect(letterResponse.status()).toBe(200);
  const cv = await cvResponse.json(),
    letter = await letterResponse.json();
  const editor = page.locator('.generation-document');
  await expect(
    editor.getByRole('heading', {
      name: 'Lettre de motivation · Version 1',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    editor.getByRole('button', {
      name: 'Exporter cette version enregistrée en PDF',
      exact: true,
    }),
  ).toBeDisabled();
  for (const checkbox of await editor
    .locator('.generation-warning input[type=checkbox]')
    .all())
    await checkbox.check();
  await editor
    .getByRole('button', {
      name: 'Valider cette version après relecture',
      exact: true,
    })
    .click();
  await expect(
    editor.getByText('Version validée manuellement.', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByText(/Coût estimé de cette version/)).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await editor
    .getByRole('button', {
      name: 'Exporter cette version enregistrée en PDF',
      exact: true,
    })
    .click();
  const download = await downloadPromise;
  await download.saveAs('.pnpm-store/e2e-letter.pdf');
  expect(
    (await readFile('.pnpm-store/e2e-letter.pdf')).subarray(0, 4).toString(),
  ).toBe('%PDF');
  const unchanged = await page.evaluate(() =>
    fetch('http://localhost:3001/resumes', { credentials: 'include' }).then(
      (response) => response.json(),
    ),
  );
  expect(unchanged.find((row) => row.id === account.resumeId).data).toEqual(
    masters.find((row) => row.id === account.resumeId).data,
  );
  await editor.scrollIntoViewIfNeeded();
  await editor.screenshot({ path: 'docs/screenshots/documents.png' });
  await page
    .getByRole('button', { name: 'Marquer comme postulée', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Offre marquée postulée', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('link', { name: 'Voir les candidatures', exact: true })
    .click();
  const card = page.locator('.application-card');
  await expect(card).toHaveCount(1);
  const handle = card.locator('[data-application-handle]');
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-status=interview]')).toHaveClass(
    /is-drop-target/,
  );
  await page.keyboard.press('Space');
  await expect(
    page.locator('[data-status=interview] .application-card'),
  ).toHaveCount(1);
  await card
    .getByRole('button', { name: 'Détails et notes', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .locator('#application-notes')
    .fill('Entretien de démonstration à préparer.');
  const today = await page.evaluate(() =>
    [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, '0'),
      String(new Date().getDate()).padStart(2, '0'),
    ].join('-'),
  );
  await dialog.locator('#application-follow-up').fill(today);
  await dialog.locator('#application-document-resume').selectOption(cv.id);
  await dialog
    .locator('#application-document-cover_letter')
    .selectOption(letter.id);
  await dialog
    .getByRole('button', { name: 'Enregistrer la candidature', exact: true })
    .click();
  await expect(
    dialog.getByText('Consulter une version utilisée', { exact: true }),
  ).toHaveCount(2);
  await dialog
    .getByRole('button', { name: 'Fermer la candidature', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-slot=dialog-overlay]')).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(card.getByText('À relancer', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/applications.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/applications-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Paramètres', exact: true }).click();
  await expect(
    page.getByText(/Les sauvegardes sont désactivées/),
  ).toBeVisible();
  await page
    .getByLabel('Horaire de collecte (UTC)', { exact: true })
    .fill('0 7 * * 1-5');
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/settings' &&
      response.request().method() === 'POST',
  );
  await page
    .locator('.profile-editor')
    .filter({ has: page.locator('#collectionCron') })
    .getByRole('button', { name: 'Enregistrer', exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.locator('#collectionCron')).toHaveValue('0 7 * * 1-5');
  await page
    .getByRole('heading', { name: 'Sauvegardes chiffrées', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/settings.png' });
  await page
    .getByRole('button', { name: 'Se déconnecter', exact: true })
    .click();
  await expect(page).toHaveURL(/\/connexion$/);
  await page.goto('/candidatures');
  await expect(page).toHaveURL(/\/connexion$/);
  expect(errors).toEqual([]);
});
