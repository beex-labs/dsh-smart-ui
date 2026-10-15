/**
 * Screenshot the rendered Mermaid diagrams with Chrome.
 *
 * Rasterizing the SVG with librsvg drops every label: Mermaid draws node text
 * as <foreignObject> HTML, which librsvg ignores. A real browser screenshot is
 * therefore the only faithful check — it is also what the user actually sees.
 *
 * Run: node test/shot-mermaid.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out-mermaid')
mkdirSync(outDir, { recursive: true })

const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))
if (BROWSER === undefined) throw new Error('no Chromium browser found')

// Lay the figures out side by side in a grid sized for a readable screenshot.
const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:20px;background:#fff;font-family:system-ui,sans-serif;width:1560px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  figure{margin:0;border:1px solid #e3e3e3;border-radius:8px;padding:10px;overflow:hidden}
  figcaption{font:600 12px system-ui;color:#555;margin-bottom:6px}
  svg{max-width:100%;height:auto;display:block}
</style></head><body>
<div class="grid" id="g"></div>
<script>
  var DATA = window.__FIGURES__;
  var g = document.getElementById('g');
  for (var i = 0; i < DATA.length; i++) {
    var f = document.createElement('figure');
    var c = document.createElement('figcaption');
    c.textContent = DATA[i].name;
    f.appendChild(c);
    f.insertAdjacentHTML('beforeend', DATA[i].svg);
    g.appendChild(f);
  }
  document.title = 'READY';
</script></body></html>`

// Pull each rendered <svg> back out of the DOM dump the render test produced.
const dom = readFileSync(join(outDir, 'rendered.html'), 'utf8')
const figures = []
for (const m of dom.matchAll(/<figure><h2>([^<]+)<\/h2>([\s\S]*?)<\/figure>/g)) {
  const svg = m[2].match(/<svg[\s\S]*?<\/svg>/)
  if (svg) figures.push({ name: m[1], svg: svg[0] })
}
console.log(`figures carried into the sheet: ${figures.map((f) => f.name).join(', ')}`)

const html = sheet.replace('<script>\n  var DATA', `<script>window.__FIGURES__ = ${JSON.stringify(figures)};</script>\n<script>\n  var DATA`)
const htmlPath = join(outDir, 'sheet.html')
writeFileSync(htmlPath, html, 'utf8')

const shot = join(outDir, '_diagrams.png')
// The browser profile goes to the OS temp directory: Chrome writes tens of
// megabytes of caches, history and cookie databases into it, none of which
// belongs in the plugin directory or in version control.
const profile = join(tmpdir(), 'dsh-smart-ui-shot-profile')
const script = `
$p = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--hide-scrollbars',
  '--force-device-scale-factor=1','--window-size=1600,4200','--virtual-time-budget=20000',
  '--user-data-dir=${profile.replace(/\\/g, '\\\\')}',
  '--screenshot=${shot.replace(/\\/g, '\\\\')}',
  ${JSON.stringify('file:///' + htmlPath.replace(/\\/g, '/'))}
) -Wait -PassThru -NoNewWindow
exit $p.ExitCode
`
execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 })

if (!existsSync(shot)) throw new Error('screenshot was not produced')
console.log(`screenshot: ${shot} (${Math.round(readFileSync(shot).length / 1024)} KB)`)
