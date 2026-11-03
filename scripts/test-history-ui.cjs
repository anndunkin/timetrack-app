// Run against an isolated test database, never a user's database.
// Requires Playwright: node scripts/test-history-ui.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5001';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 650 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const entries = [];
  const orgs = [];
  const depts = [];
  const projects = [];
  const api = async (method, path, data) => {
    const response = await page.request.fetch(`${baseURL}${path}`, { method, data });
    assert(response.ok(), `${method} ${path}: ${response.status()}`);
    return response.json();
  };
  const check = async (name, fn) => { await fn(); console.log(`PASS ${name}`); };
  const cards = page.locator('[data-testid^="card-history-"]');
  const apply = async (organizationId, start = '', end = '') => {
    await page.getByTestId('select-history-organization').selectOption(String(organizationId));
    await page.getByTestId('input-history-start').fill(start);
    await page.getByTestId('input-history-end').fill(end);
    await page.getByTestId('button-history-apply').click();
  };
  const expectTotal = async total => {
    await page.waitForFunction(value =>
      !document.querySelector('.animate-pulse') &&
      document.querySelector('[data-testid="text-history-total"]')?.textContent === `${value} ${value === 1 ? 'entry' : 'entries'}`, total);
  };
  try {
    for (const name of ['History UI Alpha', 'History UI Beta', 'History UI Empty']) {
      orgs.push(await api('POST', '/api/organizations', { name, color: '#01696F' }));
    }
    for (const org of orgs.slice(0, 2)) {
      const dept = await api('POST', '/api/departments', { name: `${org.name} Dept`, organizationId: org.id });
      depts.push(dept);
      const project = await api('POST', '/api/projects', { name: `${org.name} Project`, color: '#01696F', departmentIds: [dept.id] });
      projects.push(project);
      const count = org === orgs[0] ? 31 : 2;
      for (let i = 1; i <= count; i++) {
        entries.push(await api('POST', '/api/time-entries', {
          date: `2026-10-${String(i).padStart(2, '0')}`, minutes: 30,
          organizationId: org.id, departmentIds: [dept.id], projectId: project.id,
          description: 'Temporary organization-filter UI test',
        }));
      }
    }
    await page.goto(`${baseURL}/#/history`);
    await page.getByTestId('select-history-organization').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#history-organization option').length >= 4);
    await page.getByTestId('button-history-next').click();
    await page.getByText(/Page 2 of/).waitFor();
    await check('Organization draft does not apply until Apply is clicked', async () => {
      await page.getByTestId('select-history-organization').selectOption(String(orgs[0].id));
      assert(await page.getByText(/Page 2 of/).isVisible());
    });
    await check('Organization-only filter resets page and returns full matching page', async () => {
      await page.getByTestId('button-history-apply').click();
      await expectTotal(31);
      assert(await page.getByText('Page 1 of 2').isVisible());
      assert.equal(await cards.count(), 25);
      for (const card of await cards.all()) assert((await card.textContent()).includes(orgs[0].name));
    });
    await check('Next page retains organization filter', async () => {
      await page.getByTestId('button-history-next').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="card-history-"]').length === 6);
      assert(await page.getByText('Page 2 of 2').isVisible());
      for (const card of await cards.all()) assert((await card.textContent()).includes(orgs[0].name));
    });
    await check('Organization and inclusive date range combine', async () => {
      await apply(orgs[0].id, '2026-10-05', '2026-10-10');
      await expectTotal(6);
      assert(await page.getByText('Page 1 of 1').isVisible());
      const ids = entries.filter(e => e.organizationId === orgs[0].id && e.date >= '2026-10-05' && e.date <= '2026-10-10').map(e => e.id);
      for (const id of ids) assert(await page.getByTestId(`card-history-${id}`).isVisible());
    });
    await check('Switching organizations preserves dates and displays no-match message', async () => {
      await apply(orgs[1].id, '2026-10-05', '2026-10-10');
      await expectTotal(0);
      await page.getByText('No entries match these filters').waitFor();
    });
    await check('Organization with no entries and Clear reset all fields', async () => {
      await apply(orgs[2].id);
      await expectTotal(0);
      await page.getByTestId('button-history-clear').click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="button-history-clear"]'));
      assert.equal(await page.getByTestId('select-history-organization').inputValue(), '');
      assert.equal(await page.getByTestId('input-history-start').inputValue(), '');
      assert.equal(await page.getByTestId('input-history-end').inputValue(), '');
    });
    await check('Date-only filter still includes multiple organizations', async () => {
      await apply('', '2026-10-01', '2026-10-02');
      await page.getByTestId(`card-history-${entries[0].id}`).waitFor();
      assert(await page.getByTestId(`card-history-${entries[31].id}`).isVisible());
    });
    await check('From-only and To-only work with organization', async () => {
      await apply(orgs[0].id, '2026-10-30');
      await expectTotal(2);
      await apply(orgs[0].id, '', '2026-10-03');
      await expectTotal(3);
    });
    await check('Filters and Apply remain usable on small desktop windows', async () => {
      await page.setViewportSize({ width: 800, height: 600 });
      for (const id of ['select-history-organization', 'input-history-start', 'input-history-end', 'button-history-apply', 'button-history-clear']) {
        const box = await page.getByTestId(id).boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= 800 && box.y + box.height <= 600, id);
      }
      await page.screenshot({ path: process.env.HISTORY_SCREENSHOT || '/tmp/timetrack-history-filter.png' });
    });
    await check('Delete still asks for confirmation and Cancel preserves entry', async () => {
      await page.getByTestId(`button-delete-history-${entries[0].id}`).click();
      await page.getByRole('alertdialog').waitFor();
      await page.getByTestId('button-cancel-delete').click();
      assert(await page.getByTestId(`card-history-${entries[0].id}`).isVisible());
    });
    await check('Filtered entries still open the existing edit form', async () => {
      await page.getByTestId(`button-edit-history-${entries[0].id}`).click();
      // The edit flow consumes and removes the query parameter immediately.
      await page.getByRole('heading', { name: 'Edit Entry', exact: true }).waitFor();
      assert.equal(await page.getByTestId('input-date').inputValue(), entries[0].date);
    });
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS No uncaught browser errors');
  } finally {
    for (const entry of entries) await api('DELETE', `/api/time-entries/${entry.id}`);
    for (const project of projects) await api('DELETE', `/api/projects/${project.id}`);
    for (const dept of depts) await api('DELETE', `/api/departments/${dept.id}`);
    for (const org of orgs) await api('DELETE', `/api/organizations/${org.id}`);
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
