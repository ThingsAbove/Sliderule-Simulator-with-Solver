/**
 * Autonomous test: verifies the slide rule initializes with its bottom
 * just above the bottom of the browser window (i.e. at the bottom of the canvas).
 * Run from project root: npm run test:position
 * Or: node react/test_sliderule_position.js
 */

const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 8765;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REACT_DIR = path.join(PROJECT_ROOT, 'react');

function serveFile(reqUrl) {
  const urlPath = reqUrl === '/' ? '/hemmi_versalog_ii.html' : reqUrl;
  const filePath = path.join(REACT_DIR, urlPath.replace(/^\//, '').replace(/\?.*$/, ''));
  if (!filePath.startsWith(REACT_DIR)) return null;
  try {
    return fs.readFileSync(filePath);
  } catch (_) {
    return null;
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/hemmi_versalog_ii.html' : req.url.split('?')[0];
    const body = serveFile(urlPath);
    if (body === null) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(urlPath);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(body);
  });
}

async function runTest() {
  const { chromium } = require('playwright');
  const server = createServer();
  await new Promise((resolve) => server.listen(PORT, resolve));

  let passed = false;
  let message = '';

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/hemmi_versalog_ii.html`, { waitUntil: 'networkidle' });

    // Wait for canvas to have non-zero size (layout and first draw)
    await page.waitForFunction(
      () => {
        const canvas = document.getElementById('sliderule_canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      },
      { timeout: 10000 }
    );

    // Allow initial position to be set (first draw with correct dimensions)
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => {
      const canvas = document.getElementById('sliderule_canvas');
      if (!canvas || typeof sliderules === 'undefined') {
        return { error: 'canvas or sliderules not found' };
      }
      let totalH = 0;
      for (const i in sliderules.sliderules) {
        totalH += sliderules.sliderules[i].height();
      }
      const canvasHeight = canvas.height;
      const scale = sliderules.scale;
      const positionY = sliderules.position.y;
      const expectedY = canvasHeight / scale - totalH;
      return {
        positionY,
        expectedY,
        canvasHeight,
        scale,
        totalH,
        diff: Math.abs(positionY - expectedY),
      };
    });

    await browser.close();

    if (result.error) {
      message = result.error;
    } else {
      const tolerance = 2;
      passed = result.diff <= tolerance;
      message = passed
        ? `Slide rule bottom aligned: position.y=${result.positionY.toFixed(1)}, expected≈${result.expectedY.toFixed(1)}, diff=${result.diff.toFixed(2)} (tolerance ${tolerance})`
        : `Slide rule NOT at bottom: position.y=${result.positionY.toFixed(1)}, expected≈${result.expectedY.toFixed(1)}, diff=${result.diff.toFixed(2)} (tolerance ${tolerance})`;
    }
  } catch (err) {
    message = err.message || String(err);
  } finally {
    server.close();
  }

  console.log(message);
  process.exit(passed ? 0 : 1);
}

runTest();
