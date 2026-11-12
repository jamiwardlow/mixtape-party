// Renders header.html to header.mp4 (3840x1646, 30fps, 8s loop). Needs playwright + an ffmpeg with libx264.
// usage: node render.mjs <ffmpeg-path>
import { chromium } from '/Users/wardlowj/jamiwardlow/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30, T = 8;
const ff = spawn(process.argv[2], ['-y','-f','image2pipe','-framerate',String(FPS),'-i','-',
  '-c:v','libx264','-profile:v','high','-crf','14','-pix_fmt','yuv420p','-movflags','+faststart','-an', path.join(dir,'header.mp4')],
  { stdio: ['pipe','inherit','inherit'] });
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1920, height: 823 }, deviceScaleFactor: 2 });
await pg.goto('file://' + path.join(dir,'header.html'));
await pg.evaluate(() => document.fonts.ready);
for (let i = 0; i < FPS * T; i++) {
  await pg.evaluate(t => setT(t), i / FPS);
  if (!ff.stdin.write(await pg.screenshot({ type: 'png' }))) await new Promise(r => ff.stdin.once('drain', r));
}
ff.stdin.end(); await b.close();
