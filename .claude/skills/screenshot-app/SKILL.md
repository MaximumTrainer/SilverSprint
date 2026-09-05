---
name: screenshot-app
description: Launch SilverSprint and capture what it actually renders — demo mode or a real logged-in account. Use whenever a change touches the UI, when asked to run/screenshot the app, or before claiming a visual change works. Encodes the headless-Chrome recipe and the four capture traps that silently produce wrong screenshots.
---

# Screenshot SilverSprint

Read this before writing any browser automation for this repo. Four separate
traps here produce screenshots that look like application bugs but are not. Two
of them have already caused a real defect to be reported that did not exist.

## The traps

**1. `--virtual-time-budget` blanks the charts.** Recharts animates its line
paths on mount. Under virtual time the animation never completes, so
`chrome --headless --screenshot` captures axes and gridlines with **no data
lines at all**. Looks exactly like "the chart has no data".

**2. `captureBeyondViewport: true` crushes chart content into the left ~12%.**
It resizes the viewport to capture the full page, which re-triggers
`ResponsiveContainer`'s ResizeObserver; the capture lands mid-relayout. Looks
exactly like "the chart is rendering at the wrong width". Use a **tall window
and a plain viewport capture** instead.

**3. Port 5173 is occupied** on this machine by an unrelated app (an
"OpenFactstore" dev server). Navigating to it screenshots someone else's
product. **Always use 5199.**

**4. Backgrounded `npx vite &` with a shell redirect dies silently.** The
wrapper exits, taking the server with it. Use the Bash tool's
`run_in_background: true` on the vite command itself.

## Verify before believing a screenshot

If a chart looks empty or squashed, check the DOM before reporting a bug:

```js
document.querySelectorAll('.recharts-line-curve').length          // paths present?
[...document.querySelectorAll('.recharts-line-curve')].map(p => p.getAttribute('d').length)
document.querySelector('.recharts-surface').getBoundingClientRect().width
[...document.querySelectorAll('.recharts-line-curve')].map(p => p.style.strokeDasharray)
```

`stroke-dasharray: "845px 0px"` means the animation completed and the line is
fully drawn. If the DOM is healthy, the screenshot is lying — fix the capture.

## Start the server

Run with `run_in_background: true`:

```bash
npx vite --port 5199 --strictPort
```

Then poll — never `sleep`:

```bash
timeout 45 bash -c 'until curl -sf http://localhost:5199 >/dev/null 2>&1; do sleep 1; done'
curl -s http://localhost:5199 | grep -i '<title>'   # expect SilverSprint
```

Stop it when done:

```bash
pid=$(netstat -ano | grep ":5199" | grep LISTENING | awk '{print $5}' | head -1)
powershell -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue"
```

## Capture

Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`. There is
no `chromium-cli` and no Playwright installed — drive CDP directly. Write the
driver to the scratchpad, not the repo.

```js
// driver.mjs — run with: SP=<scratchpad> node driver.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.SP}/chrome-profile`,
  '--window-size=1300,2600',            // tall enough that the target is in view
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;

for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/list`); break; } catch { await sleep(250); } }
const pg = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page');
ws = new WebSocket(pg.webSocketDebuggerUrl);
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
await new Promise(r => { ws.onopen = r; });
await send('Page.enable'); await send('Runtime.enable');

const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); });

await send('Page.navigate', { url: 'http://localhost:5199' });
await sleep(8000);                       // real time, so Recharts finishes animating

// Clip to one card by its rect — NO captureBeyondViewport.
const box = JSON.parse(await ev(`(() => {
  const el = [...document.querySelectorAll('.icu-card')].find(e => e.textContent.includes('Next 48 Hours'));
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
})()`));
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } });
fs.writeFileSync(`${process.env.SP}/shots/out.png`, Buffer.from(shot.data, 'base64'));

console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
chrome.kill(); process.exit(0);
```

Omit the `clip` entirely for a whole-viewport shot. **Always read the resulting
image** — then check `console errors` too.

## Authenticated vs demo mode

Demo mode is the default when no `.env` exists — no credentials needed, and it
exercises the real domain via `mockDashboardData`.

For a real account, inject the session before app code runs:

```js
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `sessionStorage.setItem('silver_sprint_auth', JSON.stringify({
    athleteId: ${JSON.stringify(process.env.ICU_ID)},
    accessToken: ${JSON.stringify(process.env.ICU_KEY)},
    authType: 'basic' }));`,
});
```

Credentials come from the environment only. Use a throwaway `--user-data-dir`
under the scratchpad and **delete it afterwards** — never commit one, never
write credentials to a file.

## Driving React inputs

`el.value = x` does not fire React's onChange. Use the native setter:

```js
const proto = HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
// <select>: same trick on HTMLSelectElement.prototype, dispatch 'change'
```

## Clean up

Delete the driver script, the Chrome profile and the dev server. Screenshots may
stay in the scratchpad.
