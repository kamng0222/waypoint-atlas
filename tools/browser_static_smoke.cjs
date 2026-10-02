const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  try {
    await page.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.NavigraphAtlas?.state.ready, { timeout: 90000 });
    assert.equal(await page.locator('#cycleBadge').innerText(), 'SYNTHETIC DEMO');
    assert.match(await page.locator('.data-note').innerText(), /invented/);
    assert.equal(await page.evaluate(() => window.NavigraphAtlas.state.network.manifest.metadata.data_source), 'SYNTHETIC');
    await page.locator('#searchInput').fill('DEM00001');
    await page.waitForSelector('#searchResults .result');
    await page.locator('#searchResults .result').first().click();
    await page.waitForFunction(() => document.getElementById('detailTitle').textContent === 'DEM00001');
    await page.click('#clearSelection');
    await page.click('#mode2d');
    await page.waitForFunction(() => window.NavigraphAtlas.state.viewer.scene.mode === 2);
    await page.click('#mode3d');
    await page.waitForFunction(() => window.NavigraphAtlas.state.viewer.scene.mode === 3);
    await page.click('#home'); await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(root, 'tests/artifacts/05-public-demo.png') });
    const beforeImport = requests.length;
    await page.locator('#datasetFile').setInputFiles(path.join(root, 'cache/network.json'));
    await page.waitForFunction(() => window.NavigraphAtlas.state.ready && window.NavigraphAtlas.state.network.waypoints.length === 257277, { timeout: 120000 });
    assert.equal(await page.locator('#cycleBadge').innerText(), 'AIRAC 2610');
    assert.match(await page.locator('.data-note').innerText(), /not uploaded/);
    assert.ok(requests.slice(beforeImport).every(request => request.method === 'GET'));
    await page.locator('#searchInput').fill('BEKOL');
    await page.waitForSelector('#searchResults .result');
    await page.locator('#searchResults .result').first().click();
    await page.waitForFunction(() => document.getElementById('detailTitle').textContent === 'BEKOL');
    await page.click('#resetDemo');
    await page.waitForFunction(() => window.NavigraphAtlas.state.ready && window.NavigraphAtlas.state.network.manifest.metadata.data_source === 'SYNTHETIC', { timeout: 120000 });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => !/^https?:/.test(request.url) || request.url.startsWith('http://127.0.0.1:8766/')));
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.every(request => !request.url.includes('/api/')));
    const result = { passed: true, errors, private_data_uploaded: false, http_methods: [...new Set(requests.map(r => r.method))],
      checks: ['synthetic public demo', 'client-side search', '3D and 2D', 'full local Navigraph import', 'no upload requests', 'no backend API', 'return to demo'] };
    fs.writeFileSync(path.join(root, 'tests/artifacts/static-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch(error) {
    await page.screenshot({ path: path.join(root, 'tests/artifacts/static-failure.png') }).catch(() => {});
    console.error(error.message, errors); process.exitCode = 1;
  } finally { await browser.close(); }
})();
