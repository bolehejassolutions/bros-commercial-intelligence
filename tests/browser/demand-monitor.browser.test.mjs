import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const routePath = '/api/internal/demand-meta';
const until = '2025-03-09';

async function freePort() {
  const socket = createServer();
  const port = await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => resolve(socket.address().port));
  });
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function prepareFixture(root) {
  const source = './' + relative(root, repo).split(sep).join('/');
  const app = join(root, 'app');
  const api = join(app, 'api/internal/demand-meta');
  await mkdir(api, { recursive: true });
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({
      extends: join(repo, 'tsconfig.json'),
      compilerOptions: { baseUrl: '.', paths: {
        '@/lib/demand/meta-direct-runtime': [source + '/tests/browser/demand-monitor-fixture.ts'],
        '@/*': [source + '/*'],
      } },
      include: ['app/**/*.tsx', 'app/**/*.ts'],
    })),
    writeFile(join(app, 'layout.tsx'), 'export default function Layout({children}: {children: React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }'),
    writeFile(join(app, 'page.tsx'), [
      '"use client";',
      'import MetaMonitor from "@/app/internal/demand-meta-test/meta-monitor";',
      'export default function Page() { return <MetaMonitor getToken={async () => "demand.browser.fixture"} />; }',
    ].join('\n')),
    cp(join(repo, 'app/api/internal/demand-meta/route.ts'), join(api, 'route.ts')),
  ]);
}

async function waitForApp(origin, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error('DEMAND fixture app stopped');
    const response = await fetch(origin, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response) {
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Meta Ads monitor/);
      return;
    }
    await delay(400);
  }
  throw Error('DEMAND fixture app did not start');
}

test('DEMAND browser renders account and campaign reports and withholds invalid figures', { timeout: 120000 }, async t => {
  const scratch = join(repo, '.next');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'demand-monitor-browser-'));
  let stopApp;
  let browser;
  t.after(async () => {
    await browser?.close();
    await stopApp?.();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await prepareFixture(root);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    join(repo, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: root, env: { PATH: process.env.PATH, NEXT_TELEMETRY_DISABLED: '1', DEMAND_MONITOR_FIXTURE: 'isolated_browser' } });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-10000); });
  const stopped = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  stopApp = async () => { child.kill(); await stopped; };

  try {
    await waitForApp(origin, child);
    const requestUrl = since => `${origin}${routePath}?view=status&since=${since}&until=${until}`;
    assert.equal((await fetch(requestUrl('2025-03-03'))).status, 401);
    browser = await chromium.launch({ executablePath: process.env.DEMAND_BROWSER_CHROMIUM });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(origin);
    const monitor = page.getByRole('region', { name: 'Meta Ads monitor' });
    const start = monitor.getByLabel('Insights start date');
    await start.fill('2025-03-03');
    await monitor.getByLabel('Insights end date').fill(until);

    const read = async since => {
      await start.fill(since);
      const [response] = await Promise.all([
        page.waitForResponse(result => result.url() === requestUrl(since)),
        monitor.getByRole('button', { name: 'Read Meta status and Insights' }).click(),
      ]);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const first = await read('2025-03-03');
    assert.equal(first.insights.spend, 25.67);
    assert.equal(first.campaignInsights.spend, 12.34);
    await monitor.getByRole('heading', { name: 'Account Insights', exact: true }).waitFor();
    await monitor.getByRole('heading', { name: 'Campaign Insights', exact: true }).waitFor();
    await monitor.getByText(/^RM\s*25\.67$/).waitFor();
    await monitor.getByText(/^RM\s*12\.34$/).waitFor();

    const empty = await read('2025-03-04');
    assert.equal(empty.campaignInsights.state, 'NO_ROWS_NOT_ZERO');
    await monitor.getByText('Meta returned no rows. Spend, impressions and clicks are unknown.').waitFor();
    assert.equal(await monitor.getByText(/^RM\s*12\.34$/).count(), 0);
    await monitor.getByText(/^RM\s*25\.67$/).waitFor();

    const zero = await read('2025-03-05');
    assert.equal(zero.campaignInsights.spend, 0);
    await monitor.getByText(/^RM\s*0\.00$/).waitFor();

    await page.route(requestUrl('2025-03-06'), async route => {
      const response = await route.fetch();
      const report = await response.json();
      report.campaignInsights.campaignId = '99999999999';
      await route.fulfill({ response, json: report });
    });
    await read('2025-03-06');
    await monitor.getByText('The Meta report was incomplete or did not match the requested scope.').waitFor();
    assert.equal(await monitor.getByRole('heading', { name: 'Account Insights', exact: true }).count(), 0);
    assert.equal(await monitor.getByRole('heading', { name: 'Campaign Insights', exact: true }).count(), 0);
  } catch (error) {
    t.diagnostic(output);
    throw error;
  }
});
