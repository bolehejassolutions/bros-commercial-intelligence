import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join, relative, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import pg from 'pg';
import {createContentCampaignPlanner} from '../../lib/content/neon-content-generation-orchestrator.ts';
import {createContentGeneratedOutputWriter} from '../../lib/content/neon-content-generated-output-writer.ts';
import {compileContentPersistenceBundle} from '../../lib/content/neon-content-persistence-bundle.ts';
import {createContentTransaction} from '../../lib/content/neon-content-transaction.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const owner = '8ae086ff-3f10-4863-b5e7-4b67e062024d';
const foreign = '11111111-1111-4111-8111-111111111111';
const foreignCampaignId = '88888888-8888-4888-8888-888888888888';
const tenant = '33333333-3333-4333-8333-333333333333';
const workspaceId = randomUUID();
const workspaceName = 'Kedai Rimba — ujian pelayar ' + workspaceId.slice(0, 8);
const businessDna = {
  brand_name: 'Kedai Rimba',
  audience: {segment: 'Pemilik bengkel kecil'},
  content_creative: {brand_id: 'kedai-rimba', preset_ids: ['NATURAL_MY_UGC', 'REAL_PRODUCT_SHOWCASE']},
};
const existingCampaign = 'Kempen susulan Kedai Rimba';
const newDraft = 'Sesi servis hujung minggu';
const deniedDraft = {product_service: 'Denied tenant draft', audience: 'Fixture audience', description: '', problem: '', objective: '', duration_days: 7, platforms: ['instagram']};
const brief = {
  product_service: existingCampaign, audience: businessDna.audience.segment,
  description: 'Servis berkala untuk pelanggan bengkel', problem: 'Pelanggan terlepas tarikh servis',
  objective: 'Bantu pelanggan ingat tarikh servis seterusnya', duration_days: 7, platforms: ['instagram'],
};
const plan = {
  strategy: {positioning: 'Servis ikut masa yang sesuai', core_message: 'Semak tarikh servis di buku kereta',
    offer_angle: 'Tempah masa jika perlu', platform_strategy: ['Video pendek Instagram']},
  angles: [{title: 'Bila kali terakhir servis?', hook: 'Buku servis dah terselit di mana?',
    reason: 'Pelanggan mudah lupa tarikh apabila sibuk'}],
  scripts: [{title: 'Semak buku servis', hook: 'Bila kali terakhir kereta masuk bengkel?',
    body: 'Cari tarikh terakhir dalam buku servis.', cta: 'Tanya bengkel bila perlu datang semula.'}],
  scenes: [{scene_number: 1, duration_seconds: 5, visual_prompt: 'Pelanggan buka buku servis di bengkel',
    motion_prompt: 'Kamera mendekati buku servis', narration: 'Buka buku servis dan semak tarikhnya',
    dialogue: 'Bila patut saya datang lagi?'}, ...Array.from({length: 100}, (_, index) => ({
    scene_number: index + 2, duration_seconds: 1, visual_prompt: 'Sambungan babak ujian ' + (index + 2),
    motion_prompt: '', narration: '', dialogue: '',
  }))],
  visuals: [{title: 'Buku servis di kaunter', prompt: 'Cahaya pagi di kaunter bengkel, tanpa logo'}],
  captions: [{platform: 'instagram', caption: 'Lupa tarikh servis? Cuba semak buku servis kereta dulu.'}],
  publish_plan: [{day: 1, platform: 'instagram', content_type: 'Video pendek', objective: 'Ingatkan tarikh servis'}],
};
const review = {pass: true, score: 90, issues: [], fixes: []};

function databaseUrl(name, role) {
  const value = process.env[name];
  const url = new URL(value ?? '');
  assert.ok(
    process.env.CONTENT_PG_INTEGRATION_CI === 'disposable_only'
    && url.protocol === 'postgresql:' && url.hostname === '127.0.0.1'
    && url.port === '5432' && url.pathname === '/bros_intelligence_dev'
    && url.username === role && url.password && !url.search && !url.hash,
    'Refusing non-disposable CONTENT browser database target',
  );
  return value;
}

async function findLocalPort() {
  const server = createServer();
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function prepareFixtureApp(root) {
  const fixtureSource = './' + relative(root, join(repo, 'tests/browser/fixture-runtime.ts')).split(sep).join('/');
  const repoSource = './' + relative(root, repo).split(sep).join('/');
  const pageDirectory = join(root, 'app/content/dev');
  await mkdir(pageDirectory, {recursive: true});
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({
      extends: join(repo, 'tsconfig.json'),
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/lib/content/neon-content-sdk-auth-server.ts': [fixtureSource],
          '@/lib/content/neon-content-restricted-adapters.ts': [fixtureSource],
          '@/*': [repoSource + '/*'],
        },
      },
      include: ['app/**/*.ts', 'app/**/*.tsx'],
    })),
    cp(join(repo, 'app/layout.tsx'), join(root, 'app/layout.tsx')),
    cp(join(repo, 'app/globals.css'), join(root, 'app/globals.css')),
    writeFile(join(pageDirectory, 'page.tsx'),
      "export const dynamic = 'force-dynamic';\nexport {default} from '@/app/content/dev/page';\n"),
    cp(join(repo, 'app/api/content/dev'), join(root, 'app/api/content/dev'), {recursive: true}),
  ]);
}

async function waitForNext(origin, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error('CONTENT fixture app stopped');
    const response = await fetch(origin + '/content/dev', {signal: AbortSignal.timeout(30000)}).catch(() => null);
    if (response) {
      const body = await response.text();
      assert.equal(response.status, 200, 'CONTENT fixture page should load');
      assert.match(body, /Sesi Neon Auth belum disahkan/);
      return;
    }
    await delay(500);
  }
  throw new Error('CONTENT fixture app did not start');
}

test('browser verifies authenticated campaign content, draft persistence and tenant denial in disposable PostgreSQL', {
  timeout: 180000,
}, async t => {
  const adminUrl = databaseUrl('CONTENT_ADMIN_DB_URL', 'postgres');
  const readerUrl = databaseUrl('CONTENT_READER_DB_URL', 'content_dev_reader_v2');
  const draftUrl = databaseUrl('CONTENT_DRAFT_DB_URL', 'content_dev_draft_writer_v2');
  const generatedUrl = databaseUrl('CONTENT_TEST_DB_URL', 'content_dev_generated_writer_v1');
  const {chromium} = await import(process.env.CONTENT_BROWSER_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({executablePath: process.env.CONTENT_BROWSER_CHROMIUM});
  t.after(() => browser.close());

  const admin = new pg.Pool({connectionString: adminUrl, connectionTimeoutMillis: 5000});
  const writer = new pg.Pool({connectionString: generatedUrl, connectionTimeoutMillis: 5000});
  t.after(() => Promise.all([admin.end(), writer.end()]));
  await admin.query(`INSERT INTO content_dev.workspaces
    (id, tenant_id, owner_principal_id, name, business_dna) VALUES ($1, $2, $3, $4, $5)`,
  [workspaceId, tenant, owner, workspaceName, businessDna]);
  const generateFixture = createContentCampaignPlanner(async (_prompt, _schema, name) =>
    name === 'bros_campaign' ? plan : review);
  const prepared = await generateFixture(brief, businessDna);
  const generatedReceipt = await createContentGeneratedOutputWriter(createContentTransaction(writer))(
    {userId: owner, authenticated: true}, workspaceId, 'browser-fixture-' + workspaceId,
    brief, prepared.plan, prepared.review,
  );
  // Independent admin readback proves the seven-layer fixture was committed
  // before Chromium renders it. This is disposable PostgreSQL, not live Neon.
  const persistedGenerated = await admin.query(`
    SELECT c.tenant_id, c.owner_principal_id, c.status, c.strategy,
           c.angles, c.captions, c.publish_plan,
           (SELECT count(*)::int FROM content_dev.content_items i
             WHERE i.campaign_id=c.id AND i.tenant_id=c.tenant_id) AS item_count,
           (SELECT count(*)::int FROM content_dev.scenes s
             JOIN content_dev.content_items i ON i.id=s.content_item_id
               AND i.tenant_id=s.tenant_id
             WHERE i.campaign_id=c.id AND s.tenant_id=c.tenant_id) AS scene_count
      FROM content_dev.campaigns c WHERE c.id=$1 AND c.workspace_id=$2`,
    [generatedReceipt.id, workspaceId],
  );
  assert.equal(persistedGenerated.rowCount, 1, 'generated fixture must commit one campaign');
  const persisted = persistedGenerated.rows[0];
  assert.equal(persisted.tenant_id, tenant);
  assert.equal(persisted.owner_principal_id, owner);
  assert.equal(persisted.status, 'draft');
  const expectedCampaign = compileContentPersistenceBundle(brief, prepared.plan, prepared.review).campaign;
  assert.deepEqual(persisted.strategy, expectedCampaign.strategy);
  assert.deepEqual(persisted.angles, expectedCampaign.angles);
  // The compiler intentionally normalizes caption arrays into a platform-keyed
  // JSONB map. Compare against that durable contract, not raw model output.
  assert.deepEqual(persisted.captions, expectedCampaign.captions);
  assert.deepEqual(persisted.publish_plan, expectedCampaign.publish_plan);
  assert.ok(persisted.item_count > 0, 'scripts and visuals must persist as content items');
  assert.equal(persisted.scene_count, plan.scenes.length,
    'every generated scene must persist before authenticated HTTP readback');

  // Verify the actual script, visual-prompt and scene bodies, not only counts.
  // The admin connection is independent of the generated writer and HTTP reader.
  const expectedBundle = compileContentPersistenceBundle(brief, prepared.plan, prepared.review);
  const savedItems = await admin.query(`
    SELECT id, type, title, body, sort_order, version
      FROM content_dev.content_items
     WHERE tenant_id=$1 AND campaign_id=$2
     ORDER BY type, sort_order, id`, [tenant, generatedReceipt.id]);
  assert.equal(savedItems.rowCount, expectedBundle.items.length);
  const expectedItems = expectedBundle.items.map(({ref, ...item}) => item)
    .sort((a, b) => a.type.localeCompare(b.type) || a.sort_order - b.sort_order);
  assert.deepEqual(savedItems.rows.map(({id, ...item}) => item), expectedItems,
    'every persisted script and visual prompt must match the compiled source body');
  const sceneParent = savedItems.rows.filter(item => item.type === 'video_scenes');
  assert.equal(sceneParent.length, 1, 'all generated scenes require exactly one parent item');
  const savedScenes = await admin.query(`
    SELECT content_item_id, scene_number, duration_seconds, narration,
           dialogue, visual_prompt, motion_prompt, continuity_lock
      FROM content_dev.scenes
     WHERE tenant_id=$1 AND content_item_id=$2
     ORDER BY scene_number`, [tenant, sceneParent[0].id]);
  assert.equal(savedScenes.rowCount, expectedBundle.scenes.length);
  assert.deepEqual(savedScenes.rows.map(({content_item_id, ...scene}) => ({
      ...scene,
      // pg returns PostgreSQL NUMERIC as a string; compare its exact numeric value.
      duration_seconds: Number(scene.duration_seconds),
    })),
    expectedBundle.scenes.map(({content_item_ref, ...scene}) => scene),
    'every persisted scene body must match the approved deterministic fixture');


  const scratch = join(repo, '.next');
  await mkdir(scratch, {recursive: true});
  const fixtureRoot = await mkdtemp(join(scratch, 'content-browser-'));
  let stopNext;
  t.after(async () => {
    await stopNext?.();
    await rm(fixtureRoot, {recursive: true, force: true, maxRetries: 5});
  });
  await prepareFixtureApp(fixtureRoot);
  const port = await findLocalPort();
  // Next dev normalizes the loopback IPv4 bind to localhost in Route Handler
  // Request URLs. Use the same host in the browser's Origin.
  const origin = 'http://localhost:' + port;
  const ownerSession = randomUUID();
  const foreignSession = randomUUID();
  const child = spawn(process.execPath, [
    join(repo, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port),
  ], {
    cwd: fixtureRoot, windowsHide: true,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NEXT_TELEMETRY_DISABLED: '1',
      VERCEL_ENV: 'preview',
      CONTENT_DEV_API_ENABLED: 'true',
      CONTENT_PG_INTEGRATION_CI: 'disposable_only',
      CONTENT_BROWSER_OWNER_ID: owner,
      CONTENT_BROWSER_FOREIGN_ID: foreign,
      CONTENT_BROWSER_OWNER_SESSION: ownerSession,
      CONTENT_BROWSER_FOREIGN_SESSION: foreignSession,
      CONTENT_READER_DB_URL: readerUrl,
      CONTENT_DRAFT_DB_URL: draftUrl,
    },
  });
  let nextOutput = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { nextOutput = (nextOutput + data).slice(-16000); });
  }
  const stopped = new Promise(resolve => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  stopNext = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
  };

  try {
    await waitForNext(origin, child);
    const contentUrl = origin + '/content/dev';
    const apiUrl = origin + '/api/content/dev/workspaces/' + workspaceId;
    const ownerContext = await browser.newContext();
    const foreignContext = await browser.newContext();
    const anonymousContext = await browser.newContext();
    for (const context of [ownerContext, foreignContext, anonymousContext]) {
      await context.route('**/*', route =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    }
    await ownerContext.addCookies([{name: 'content-browser-fixture', value: ownerSession, url: origin, httpOnly: true}]);
    await foreignContext.addCookies([{name: 'content-browser-fixture', value: foreignSession, url: origin, httpOnly: true}]);

    const anonymousPage = await anonymousContext.newPage();
    await anonymousPage.goto(contentUrl);
    await anonymousPage.getByText('Sesi Neon Auth belum disahkan.').waitFor();
    assert.equal((await anonymousContext.request.get(apiUrl)).status(), 401);
    const anonymousDraftWrite = await anonymousContext.request.post(apiUrl + '/campaign-drafts', {
      headers: {'idempotency-key': 'anonymous-denied-fixture-20261112'},
      data: deniedDraft,
    });
    assert.equal(anonymousDraftWrite.status(), 401);

    const foreignPage = await foreignContext.newPage();
    await foreignPage.goto(contentUrl);
    await foreignPage.getByRole('heading', {name: 'Other tenant campaign', exact: true}).waitFor();
    assert.equal(await foreignPage.getByRole('button', {name: workspaceName}).count(), 0);
    assert.equal(await foreignPage.getByText('Sediakan arahan visual', {exact: true}).count(), 0);
    const denial = await foreignContext.request.get(apiUrl, {headers: {'x-user-id': owner}});
    assert.equal(denial.status(), 404);
    assert.deepEqual(await denial.json(), {error: 'not_found'});
    // An authenticated user from another tenant must not write into this workspace,
    // even when supplying the owner's identity in an untrusted request header.
    const foreignDraftWrite = await foreignContext.request.post(apiUrl + '/campaign-drafts', {
      headers: {'x-user-id': owner, 'idempotency-key': 'foreign-denied-fixture-20261112'},
      data: deniedDraft,
    });
    assert.equal(foreignDraftWrite.status(), 404);
    assert.deepEqual(await foreignDraftWrite.json(), {error: 'not_found'});

    const page = await ownerContext.newPage();
    await page.route(apiUrl, route => route.fulfill({
      status: 503, json: {error: 'workspace_unavailable'},
    }), {times: 1});
    await page.goto(contentUrl);
    await page.getByRole('button', {name: workspaceName, exact: true}).click();
    await page.getByRole('button', {name: 'Cuba semula', exact: true}).click();
    await page.getByRole('heading', {name: 'Profil perniagaan (Business DNA)'}).waitFor();
    await page.getByText(businessDna.audience.segment, {exact: false}).first().waitFor();
    const campaign = page.getByRole('article').filter({has: page.getByRole('heading', {name: existingCampaign, exact: true})});
    await campaign.getByText('Lihat kandungan kempen', {exact: true}).click();
    const sections = [
      ['Strategi', plan.strategy.core_message],
      ['Sudut kandungan', plan.angles[0].title],
      ['Skrip', plan.scripts[0].title],
      ['Babak video', plan.scenes[0].narration],
      ['Arahan visual', plan.visuals[0].prompt],
      ['Kapsyen', plan.captions[0].caption],
      ['Pelan penerbitan', plan.publish_plan[0].objective],
    ];
    for (const [heading, content] of sections) {
      await campaign.getByRole('heading', {name: heading, exact: true}).waitFor();
      await campaign.getByText(content, {exact: false}).first().waitFor();
    }

    await campaign.getByText('Visual: Sambungan babak ujian 101', {exact: true}).waitFor();
    await campaign.getByText('Sediakan arahan visual', {exact: true}).click();
    const presetSelect = campaign.getByRole('combobox', {name: 'Gaya visual', exact: true});
    await presetSelect.waitFor();
    assert.deepEqual(await presetSelect.locator('option').evaluateAll(options => options.map(option => option.value)),
      ['', 'NATURAL_MY_UGC', 'REAL_PRODUCT_SHOWCASE']);
    await presetSelect.selectOption('NATURAL_MY_UGC');
    await campaign.getByLabel('Nisbah gambar', {exact: true}).selectOption('4:5');
    const creativeDraft = campaign.getByLabel('Arahan visual untuk disalin', {exact: true});
    assert.match(await creativeDraft.inputValue(), /Foto candid gaya Malaysia · 4:5/);
    assert.match(await creativeDraft.inputValue(), /Kempen susulan Kedai Rimba/);
    assert.doesNotMatch(await creativeDraft.inputValue(), /BROS SELL|Jangan suruh pelanggan terjemah/);
    await presetSelect.selectOption('REAL_PRODUCT_SHOWCASE');
    await campaign.getByRole('status').filter({hasText: /Perlu tangkap layar produk asal/}).waitFor();
    assert.equal(await creativeDraft.count(), 0);

    const fillDraft = async () => {
      await page.getByLabel('Produk / servis').fill(newDraft);
      await page.getByLabel('Sasaran pelanggan').fill('Pelanggan yang bekerja pada hari biasa');
      await page.getByRole('checkbox', {name: 'facebook'}).uncheck();
      await page.getByRole('checkbox', {name: 'instagram'}).check();
    };
    const draftEndpoint = apiUrl + '/campaign-drafts';
    const submit = page.getByRole('button', {name: 'Simpan draf kempen', exact: true});
    const pendingRetryEntries = () => page.evaluate(() => Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith('bros.content.pending-draft.v1.')));
    let firstPost;
    let firstKey;
    await page.route(draftEndpoint, async route => {
      firstKey = route.request().headers()['idempotency-key'];
      firstPost = await route.fetch();
      // The server commits the draft before its response is lost by the browser.
      await route.abort('connectionreset');
    }, {times: 1});
    await fillDraft();
    await submit.click();
    await page.getByRole('alert').filter({hasText: 'Simpanan draf belum dapat disahkan.'}).waitFor();
    assert.equal(firstPost.status(), 201);
    const initialReceipt = (await firstPost.json()).data;
    assert.equal(initialReceipt.status, 'draft');
    assert.equal(initialReceipt.replayed, false);
    const pending = await pendingRetryEntries();
    assert.equal(pending.length, 1);
    assert.match(pending[0][0], /^bros\.content\.pending-draft\.v1\.[0-9a-f]{64}$/);
    assert.equal(pending[0][1], firstKey);

    // Put the committed draft beyond the first page before the retry.
    await admin.query(`INSERT INTO content_dev.campaigns
      (tenant_id, workspace_id, owner_principal_id, product_service, audience, duration_days, created_at)
      SELECT $1, $2, $3, 'Kempen halaman ' || n, 'Ujian', 7, now() + interval '1 day'
      FROM generate_series(1, 100) AS n`, [tenant, workspaceId, owner]);
    await page.reload();
    await page.getByRole('button', {name: workspaceName, exact: true}).click();
    const nextPage = page.getByRole('button', {name: 'Halaman seterusnya'});
    await nextPage.waitFor();
    assert.equal(await page.getByRole('heading', {name: newDraft, exact: true}).count(), 0);
    await fillDraft();
    const draftReadUrl = apiUrl + '?draft=' + initialReceipt.id;
    const draftReadResponse = page.waitForResponse(response =>
      response.url() === draftReadUrl && response.request().method() === 'GET');
    const draftResponse = page.waitForResponse(response =>
      response.url() === draftEndpoint && response.request().method() === 'POST');
    await submit.click();
    const replay = await draftResponse;
    assert.equal(replay.status(), 201);
    assert.equal(replay.request().headers()['idempotency-key'], firstKey);
    assert.deepEqual((await replay.json()).data, {...initialReceipt, replayed: true});
    const readback = await draftReadResponse;
    assert.equal(readback.status(), 200);
    assert.equal(readback.headers()['cache-control'], 'no-store');
    const draftDetail = (await readback.json()).data;
    assert.deepEqual(draftDetail.campaigns.map(row => row.id), [initialReceipt.id]);
    assert.deepEqual(draftDetail.contentItems, []);
    assert.deepEqual(draftDetail.scenes, []);
    assert.equal(draftDetail.nextCursor, null);
    await page.getByRole('status').filter({hasText: /Gunakan Halaman seterusnya untuk mencari draf ini/}).waitFor();
    assert.deepEqual(await pendingRetryEntries(), []);
    assert.equal(await page.getByRole('heading', {name: /^Kempen halaman /}).count(), 100);
    assert.equal((await anonymousContext.request.get(draftReadUrl)).status(), 401);
    const foreignDraftRead = await foreignContext.request.get(draftReadUrl, {headers: {'x-user-id': owner}});
    assert.equal(foreignDraftRead.status(), 404);
    assert.deepEqual(await foreignDraftRead.json(), {error: 'not_found'});
    const mismatchedDraftRead = await ownerContext.request.get(apiUrl + '?draft=' + foreignCampaignId);
    assert.equal(mismatchedDraftRead.status(), 404);
    assert.deepEqual(await mismatchedDraftRead.json(), {error: 'not_found'});
    await nextPage.click();
    await page.getByRole('heading', {name: newDraft, exact: true}).waitFor();
    // Rejected anonymous and foreign-tenant writes must leave no visible campaign records.
    assert.equal(await page.getByRole('heading', {name: deniedDraft.product_service, exact: true}).count(), 0);
    // Independent database connection verifies the HTTP receipt is durable and
    // the lost-response replay did not insert a second campaign.
    const {rows} = await admin.query(
      `SELECT id, tenant_id, owner_principal_id, status, product_service,
              audience, platforms, duration_days
         FROM content_dev.campaigns
        WHERE workspace_id=$1 AND product_service=$2`,
      [workspaceId, newDraft],
    );
    assert.deepEqual(rows, [{
      id: initialReceipt.id,
      tenant_id: tenant,
      owner_principal_id: owner,
      status: 'draft',
      product_service: newDraft,
      audience: 'Pelanggan yang bekerja pada hari biasa',
      platforms: ['instagram'],
      duration_days: 7,
    }], 'HTTP draft receipt must match one independently persisted PostgreSQL row');
    const deniedRows = await admin.query(
      'SELECT id FROM content_dev.campaigns WHERE workspace_id=$1 AND product_service=$2',
      [workspaceId, deniedDraft.product_service],
    );
    assert.equal(deniedRows.rowCount, 0, 'rejected writes must not persist campaigns');
    // An expired browser session must not retain authenticated workspace access.
    // This is synthetic-session acceptance, not connected Neon Auth acceptance.
    await ownerContext.clearCookies();
    // Expiry while the SPA stays mounted must invalidate its workspace index,
    // not leave tenant-scoped controls accessible until a full reload.
    await page.getByRole('button', {name: 'Muat semula kempen workspace ini'}).click();
    await page.getByText('Sesi tamat. Sila log masuk semula.').first().waitFor();
    await page.getByRole('button', {name: workspaceName, exact: true}).waitFor({state: 'detached'});
    assert.equal(await page.getByLabel('Produk / servis').count(), 0,
      'expired session must remove the draft form without requiring a page reload');
    await page.reload();
    await page.getByText('Sesi Neon Auth belum disahkan.').waitFor();
    assert.equal((await ownerContext.request.get(apiUrl)).status(), 401);
    const expiredReceiptRead = await ownerContext.request.get(draftReadUrl);
    assert.equal(expiredReceiptRead.status(), 401, 'expired sessions must not read persisted draft receipts');
    // An expired session must also fail closed for draft writes, not only reads.
    const deniedDraftWrite = await ownerContext.request.post(apiUrl + '/campaign-drafts', {
      data: {product_service: 'Unauthorized expired-session draft'},
    });
    assert.equal(deniedDraftWrite.status(), 401);
    assert.equal(await page.getByRole('heading', {name: existingCampaign, exact: true}).count(), 0);
    assert.equal(await page.getByRole('heading', {name: newDraft, exact: true}).count(), 0);

    // Re-authentication should recover the same durable draft from PostgreSQL.
    await ownerContext.addCookies([{name: 'content-browser-fixture', value: ownerSession, url: origin, httpOnly: true}]);
    await page.reload();
    await page.getByRole('button', {name: workspaceName, exact: true}).click();
    await nextPage.click();
    await page.getByRole('heading', {name: existingCampaign, exact: true}).waitFor();
    await page.getByRole('heading', {name: newDraft, exact: true}).waitFor();
    const recoveredReceiptRead = await ownerContext.request.get(draftReadUrl);
    assert.equal(recoveredReceiptRead.status(), 200, 'reauthenticated owner can recover the same draft receipt');
    assert.deepEqual((await recoveredReceiptRead.json()).data.campaigns.map(row => row.id), [initialReceipt.id]);
    // Prove the seven persisted layers remain accessible after session expiry,
    // re-authentication and pagination, rather than trusting the initial render.
    const recoveredCampaign = page.getByRole('article').filter({
      has: page.getByRole('heading', {name: existingCampaign, exact: true}),
    });
    await recoveredCampaign.getByText('Lihat kandungan kempen', {exact: true}).click();
    for (const [heading, content] of sections) {
      await recoveredCampaign.getByRole('heading', {name: heading, exact: true}).waitFor();
      await recoveredCampaign.getByText(content, {exact: false}).first().waitFor();
    }
    await recoveredCampaign.getByText('Visual: Sambungan babak ujian 101', {exact: true}).waitFor();
    assert.equal(await page.getByRole('heading', {name: /^Kempen halaman /}).count(), 0);
    await page.getByRole('button', {name: 'Halaman sebelumnya'}).click();
    await page.getByRole('button', {name: 'Halaman seterusnya'}).waitFor();
    assert.equal(await page.getByRole('heading', {name: /^Kempen halaman /}).count(), 100);
  } catch (error) {
    t.diagnostic(nextOutput);
    throw error;
  }
});
