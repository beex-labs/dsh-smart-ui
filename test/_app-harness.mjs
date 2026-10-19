/**
 * Shared headless-browser harness for the `app` / `playground` checks.
 *
 * Imported by test/app-render.mjs, test/app-interaction.mjs and test/shot-app.mjs,
 * so the three scripts share one copy of the plumbing instead of three:
 *
 *   - the Chrome/Edge lookup and the PowerShell launcher (a Windows GUI binary
 *     detaches from the calling console, so stdout/stderr go to files);
 *   - the HTML scaffold that loads React 18 UMD from unpkg and the real
 *     `client.js` plus its generated `client.*.js` chunks;
 *   - the in-page runtime `window.H`: it stubs `window.__ModuleLoader__`, runs
 *     the module factory the way the shell does, wires `require.async` to the
 *     chunk registry (with an optional reject list to force fallbacks), and
 *     mounts specs with real DOM events.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const root = join(here, '..')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
export const BROWSER = CHROME_CANDIDATES.find((p) => existsSync(p))
if (BROWSER === undefined) throw new Error('no Chromium browser found for headless rendering')

export const REACT = 'https://unpkg.com/react@18/umd/react.production.min.js'
export const REACT_DOM = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'

/** Source of a generated lazy chunk, or '' when it has not been built yet. */
export const chunkSource = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '')

/**
 * Run headless Chrome once through PowerShell with file redirection.
 * @param options - {args, outFile, errFile, timeout}.
 */
function runChromium({ args, outFile, errFile, timeout = 240000 }) {
  const script = `
$p = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  ${args.map((a) => JSON.stringify(a)).join(',\n  ')}
) -Wait -PassThru -NoNewWindow${outFile ? ` -RedirectStandardOutput ${JSON.stringify(outFile)}` : ''} -RedirectStandardError ${JSON.stringify(errFile)}
exit $p.ExitCode
`
  try {
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], timeout })
  } catch (error) {
    // A detached GUI binary can still have written its output; read it anyway.
    if (!existsSync(outFile ?? errFile)) throw error
  }
}

/**
 * Load one page headlessly and return the post-script DOM.
 * @param htmlPath - absolute path of the page.
 * @param outFile - where the DOM dump lands.
 * @param errFile - where stderr lands.
 * @param opts - {budget, width, height, profile}.
 * @returns the dumped DOM.
 */
export function dumpDom(htmlPath, outFile, errFile, { budget = 20000, width = 1280, height = 1200, profile = join(tmpdir(), 'dsh-iui-app-profile') } = {}) {
  runChromium({
    args: [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
      `--virtual-time-budget=${budget}`, `--window-size=${width},${height}`,
      `--user-data-dir=${profile}`, '--dump-dom', 'file:///' + htmlPath.replace(/\\/g, '/'),
    ],
    outFile, errFile,
  })
  return readFileSync(outFile, 'utf8')
}

/**
 * Screenshot one page headlessly.
 * @param htmlPath - absolute path of the page.
 * @param pngPath - target PNG.
 * @param errFile - where stderr lands.
 * @param opts - {budget, width, height, profile}.
 */
export function shoot(htmlPath, pngPath, errFile, { budget = 15000, width = 1280, height = 1500, profile = join(tmpdir(), 'dsh-iui-app-profile') } = {}) {
  runChromium({
    args: [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
      `--virtual-time-budget=${budget}`, `--window-size=${width},${height}`,
      `--user-data-dir=${profile}`, `--screenshot=${pngPath}`, 'file:///' + htmlPath.replace(/\\/g, '/'),
    ],
    errFile,
  })
}

/** Dark-mode overrides for every token `readColors`/`TONE_TOKEN` and the CSS read. */
const DARK_TOKENS = `:root{
--dsw-alias-bg-base:#121418;--dsw-alias-bg-layer-1:#1b1f27;--dsw-alias-bg-layer-2:#252b36;
--dsw-alias-label-primary:#e8eaed;--dsw-alias-label-secondary:#9aa4b2;
--dsw-alias-border-l1:#333a45;--dsw-alias-border-l2:#454e5c;
--dsw-alias-brand-primary:#58a6e8;--dsw-alias-state-success-primary:#4caf50;
--dsw-alias-state-warn-primary:#e0a040;--dsw-alias-state-error-primary:#ef6c6c;
--dsw-alias-state-idle-primary:#8b95a3;
}`

// The in-page runtime: module loader stub, require/require.async, plugin apply,
// and the mount + real-event helpers the scripts drive the DOM with.
const PRE = `window.__pending=[];window.__ModuleLoader__={load:function(r){window.__pending.push(r)}};`

const SETUP = String.raw`
var React = window.React, ReactDOM = window.ReactDOM;
window.__ctxErrors = [];
window.__pageErrors = [];
var origError = console.error;
console.error = function () { window.__pageErrors.push([].join.call(arguments, ' ')); origError.apply(console, arguments) };
window.addEventListener('error', function (e) { window.__pageErrors.push('window.onerror: ' + (e.message || e)) });

function reg(id) {
  for (var i = 0; i < window.__pending.length; i += 1) if (window.__pending[i].id === id) return window.__pending[i];
  return null;
}
var mods = {};
function req(id) {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
}
req.async = function (rel) {
  var file = String(rel).slice(0, 2) === './' ? String(rel).slice(2) : String(rel);
  if (window.__reject.indexOf(file) >= 0) return Promise.reject(new Error('chunk rejected by test harness: ' + file));
  try {
    if (!mods[file]) {
      var r = reg('dsh-intelligent-ui/' + file);
      if (r === null) throw new Error('chunk not present in page: ' + file);
      mods[file] = r.factory(req);
    }
    return Promise.resolve(mods[file]);
  } catch (error) { return Promise.reject(error) }
};

var EN = null, mounted = null;
var ctx = {
  effect: function (fn, name) {
    try { var out = fn(); return typeof out === 'function' ? out : function () {} }
    catch (error) { window.__ctxErrors.push(name + ': ' + (error && error.message || error)); return function () {} }
  },
  on: function () { return function () {} },
  locale: { register: function (ns, dicts) { EN = dicts.en; return function () {} } },
  slots: {
    inject: function (key, cb) { try { cb() } catch (error) { window.__ctxErrors.push('slots.inject: ' + (error && error.message || error)) } return function () {} },
    register: function (options, component) { mounted = component; return function () {} },
  },
};
try { reg('dsh-intelligent-ui').factory(req).apply(ctx) }
catch (error) { window.__ctxErrors.push('apply: ' + (error && error.stack || error)) }
// Stand in for the shell: the theme presenter publishes the setting here.
document.body.style.setProperty('--dsh-content-font-size', '14px');

// Real DOM events, no ReactTestUtils: assign through the prototype setter so
// React's value tracker sees a change, then dispatch the native event the
// component's onChange is wired to.
function nativeSetter(el) {
  var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value').set;
}

window.H = {
  t: function (k) { return EN && EN[k] !== undefined ? EN[k] : k },
  errors: window.__ctxErrors,
  pageErrors: window.__pageErrors,
  mounted: mounted,
  mount: function (spec, opts) {
    var host = document.createElement('div');
    host.style.width = ((opts && opts.width) || 760) + 'px';
    document.getElementById('harness').appendChild(host);
    var root = ReactDOM.createRoot(host);
    root.render(React.createElement(mounted, {
      block: { kind: 'tool', call: { argsRaw: JSON.stringify({ spec: spec }) } },
      t: window.H.t,
    }));
    return {
      host: host, root: root,
      q: function (s) { return host.querySelector(s) },
      qa: function (s) { return Array.prototype.slice.call(host.querySelectorAll(s)) },
      text: function () { return host.textContent || '' },
      unmount: function () { root.unmount(); host.remove() },
    };
  },
  wait: function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) },
  waitFor: async function (fn, ms) {
    var deadline = Date.now() + (ms || 3000);
    for (;;) {
      var last = fn();
      if (last) return last;
      if (Date.now() > deadline) return last;
      await window.H.wait(15);
    }
  },
  setValue: function (el, value) {
    nativeSetter(el).call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  changeSelect: function (el, value) {
    nativeSetter(el).call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  click: function (el) { el.click() },
  button: function (handle, label) {
    var els = handle.qa('button');
    for (var i = 0; i < els.length; i += 1) {
      if ((els[i].textContent || '').trim() === label) return els[i];
    }
    return null;
  },
  snapshot: function (handle) {
    var values = handle.qa('input, textarea, select').map(function (el) {
      return el.tagName + ':' + (el.type || '') + ':' + (el.type === 'checkbox' ? String(el.checked) : String(el.value));
    });
    return handle.text() + ' || ' + values.join(',');
  },
  readApp: function (handle) {
    return {
      text: handle.text(),
      kpis: handle.qa('.iui-kpi-value').map(function (el) { return el.textContent.trim() }),
      bars: handle.qa('.iui-bar-value').map(function (el) { return el.textContent.trim() }),
      barLabels: handle.qa('.iui-bar-label').map(function (el) { return el.textContent.trim() }),
      cells: handle.qa('.iui-table td').map(function (el) { return el.textContent.trim() }),
      toasts: handle.qa('.iui-toast-item').map(function (el) { return { tone: el.getAttribute('data-tone'), text: el.textContent.trim() } }),
      nodeErrors: handle.qa('.iui-node-error').map(function (el) { return el.textContent.trim() }),
      bindErrors: handle.qa('.iui-bind-error').map(function (el) { return el.textContent.trim() }),
      empty: handle.qa('.iui-empty').map(function (el) { return el.textContent.trim() }),
      stream: handle.qa('.iui-stream-bar').map(function (el) { return el.textContent.trim() }),
      validate: handle.qa('.iui-validate').map(function (el) { return { ok: el.getAttribute('data-ok'), text: el.textContent.trim() } }),
      kpiCount: handle.qa('.iui-kpi').length,
    };
  },
  // Try one real interaction per control until the DOM visibly moves.
  autoInteract: async function (handle) {
    var before = window.H.snapshot(handle);
    var tried = [];
    var els = handle.qa('input, textarea, select, button');
    for (var i = 0; i < els.length; i += 1) {
      var el = els[i];
      var what = describe(el);
      if (!tryInteract(el)) continue;
      await window.H.wait(90);
      var after = window.H.snapshot(handle);
      tried.push(what + ' -> ' + (after === before ? 'no change' : 'changed'));
      if (after !== before) return { ok: true, via: what, before: before.slice(0, 500), after: after.slice(0, 500), tried: tried };
    }
    return { ok: false, via: null, before: before.slice(0, 500), after: window.H.snapshot(handle).slice(0, 500), tried: tried };
  },
};
function describe(el) {
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.type ? '[' + el.type + ']' : '')
    + ' "' + ((el.textContent || el.value || '').trim().slice(0, 24)) + '"';
}
function tryInteract(el) {
  var tag = el.tagName;
  if (tag === 'BUTTON') { if (el.disabled) return false; window.H.click(el); return true; }
  if (tag === 'SELECT') {
    var other = null;
    for (var i = 0; i < el.options.length; i += 1) if (el.options[i].value !== el.value) { other = el.options[i]; break }
    if (other === null) return false;
    window.H.changeSelect(el, other.value);
    return true;
  }
  if (tag === 'TEXTAREA') { window.H.setValue(el, (el.value || '') + ' edited'); return true; }
  if (el.type === 'checkbox' || el.type === 'radio') { window.H.click(el); return true; }
  if (el.type === 'hidden' || el.type === 'file') return false;
  if (el.type === 'number' || el.type === 'range') {
    // Move by one step: a range input snaps a +1 back to its old value when
    // the step is larger, and then nothing in the DOM would move.
    var step = Number(el.step);
    var delta = Number.isFinite(step) && step > 0 ? step : 1;
    var n = Number(el.value);
    var max = Number(el.max);
    var next = Number.isFinite(n) ? n + delta : Number(el.min || 0);
    if (Number.isFinite(max) && next > max) next = n - delta;
    window.H.setValue(el, String(next));
    return true;
  }
  window.H.setValue(el, (el.value || '') + 'x');
  return true;
}
`

/**
 * Build one full HTML test page.
 * @param options - {body, chunks, reject, dark, width}.
 *   body: page-specific script; chunks: generated chunk file names to inline;
 *   reject: chunk file names `require.async` must refuse (fallback testing).
 * @returns the HTML source.
 */
export function pageHtml({ body, chunks = ['client.engine.js'], reject = [], dark = false, width = 1240 }) {
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  const inline = chunks.map((file) => `<script>${chunkSource(file)}</script>`).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${dark ? DARK_TOKENS : ''}
body{margin:0;padding:16px;font-family:system-ui,sans-serif;width:${width}px;${dark ? 'background:#121418;color:#e8eaed' : ''}}
#errors{display:none}</style>
</head><body>
<div id="harness"></div>
<script src="${REACT}"></script>
<script src="${REACT_DOM}"></script>
<script>${PRE}</script>
<script>${client}</script>
${inline}
<script>window.__reject=${JSON.stringify(reject)};</script>
<script>${SETUP}</script>
<script>${body}</script>
</body></html>`
}

/**
 * Decode a `RESULT:`/`SHOT:` payload the page reported through document.title.
 * @param dom - the dumped DOM.
 * @param prefix - the marker before the JSON.
 * @returns the parsed object, or null when the page never reported.
 */
export function titleResult(dom, prefix) {
  const title = dom.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
  if (!title.startsWith(prefix)) return null
  return JSON.parse(title.slice(prefix.length)
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
}

/** Error list a shot page parked in a hidden <pre id="errors">. */
export function domErrors(dom) {
  const raw = dom.match(/ERRORS:(\[.*?\])<\/pre>/s)?.[1] ?? '[]'
  return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
}
