// Renders search.html to search-results.png (3840x2560, 3:2, the max Apple allows). Needs playwright.
import { chromium } from '/Users/wardlowj/jamiwardlow/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1920, height: 1280 }, deviceScaleFactor: 2 });
await pg.goto('file://' + path.join(dir, 'search.html'));
await pg.evaluate(() => document.fonts.ready);
await pg.screenshot({ path: path.join(dir, 'search-results.png') });
await b.close();
