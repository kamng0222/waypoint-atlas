/* Optional developer QA: requires Playwright, separate from runtime. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = path.join(__dirname, '..', 'tests', 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:8765/')) externalRequests.push(request.url()); });
  const start = Date.now();
  try {
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.NavigraphAtlas?.state.ready, { timeout: 120000 });
    await page.waitForFunction(() => [...window.NavigraphAtlas.state.layers.values()].every((primitive) => primitive.ready));
    await page.waitForTimeout(1500);
    const counts = await page.evaluate(() => ({
      waypoints: window.NavigraphAtlas.state.network.waypoints.length,
      segments: window.NavigraphAtlas.state.network.segments.length,
      dots: window.NavigraphAtlas.state.pointCollections.reduce((n, collection) => n + collection.length, 0),
      layers: [...window.NavigraphAtlas.state.layers.keys()],
    }));
    assert.equal(counts.waypoints, 257277); assert.equal(counts.segments, 91099); assert.equal(counts.dots, 47317);
    await page.screenshot({ path: path.join(output, '01-globe.png') });
    await page.click('[data-preset="asia"]'); await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(output, '02-east-asia.png') });
    await page.locator('#searchInput').fill('BEKOL');
    await page.waitForSelector('#searchResults .result');
    await page.locator('#searchResults .result').first().click();
    await page.waitForFunction(() => document.getElementById('detailTitle').textContent === 'BEKOL');
    assert.match(await page.locator('#detailBody').innerText(), /Recorded connections/);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(output, '03-waypoint.png') });
    await page.click('#clearSelection');
    await page.locator('#searchInput').fill('A1');
    await page.waitForSelector('#searchResults .result');
    await page.locator('#searchResults .result').filter({ hasText: 'links' }).first().click();
    await page.waitForFunction(() => document.getElementById('detailKind').textContent === 'PUBLISHED AIRWAY');
    assert.ok(await page.evaluate(() => window.NavigraphAtlas.state.selectedEntities.length > 0));
    await page.click('#clearSelection');
    await page.click('#mode2d');
    await page.waitForFunction(() => window.NavigraphAtlas.state.viewer.scene.mode === 2, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.NavigraphAtlas.state.viewer.scene.mode), 2);
    await page.click('#home'); await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(output, '04-flat-map.png') });
    await page.locator('[data-layer="J"]').uncheck();
    assert.equal(await page.evaluate(() => window.NavigraphAtlas.state.layers.get('J').show), false);
    assert.match(await page.locator('#status').innerText(), /61,638/);
    await page.locator('[data-layer="J"]').check();
    await page.locator('#opacity').fill('75'); await page.locator('#opacity').dispatchEvent('input');
    assert.equal(await page.locator('#opacityValue').innerText(), '75%');
    await page.locator('#allPoints').check();
    await page.waitForFunction(() => !document.getElementById('allPoints').disabled, { timeout: 120000 });
    assert.equal(await page.evaluate(() => window.NavigraphAtlas.state.pointCollections.reduce((n, collection) => n + collection.length, 0)), 257277);
    await page.locator('#allPoints').uncheck();
    await page.waitForFunction(() => !document.getElementById('allPoints').disabled, { timeout: 120000 });
    await page.click('#mode3d');
    await page.waitForFunction(() => window.NavigraphAtlas.state.viewer.scene.mode === 3, { timeout: 30000 });
    await page.click('[data-camera="right"]');
    await page.locator('#autoRotate').check(); await page.waitForTimeout(800); await page.locator('#autoRotate').uncheck();
    assert.equal(await page.evaluate(() => window.NavigraphAtlas.state.viewer.scene.mode), 3);
    assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
    const report = { passed: true, elapsed_seconds: (Date.now() - start) / 1000, counts, errors, externalRequests,
      checks: ['3D globe', 'regional camera', 'waypoint search and incident links', 'airway search', '2D map', 'layer counts', 'opacity', 'all 257277 waypoint dots', '3D return', 'camera rotation', 'zero external requests'] };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, errors, externalRequests }, null, 2));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
