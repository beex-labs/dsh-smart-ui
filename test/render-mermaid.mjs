/**
 * Render real Mermaid diagrams in headless Edge and report what came out.
 *
 * This is the check that matters for "is the diagram layer actually good":
 * the generated chunk is loaded exactly as the ModuleLoader would load it, then
 * Mermaid renders each diagram family in a real browser. Assertions cannot tell
 * you whether a sequence diagram is legible; a rendered page can.
 *
 * Run: node test/render-mermaid.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(here, 'out-mermaid')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// A Windows GUI-subsystem binary detaches from the calling console, so plain
// spawn/stdout capture yields nothing. Launch through PowerShell's
// Start-Process with explicit redirection instead.
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const BROWSER = CHROME_CANDIDATES.find((p) => existsSync(p))
if (BROWSER === undefined) throw new Error('no Chromium browser found for headless rendering')

/**
 * Render one local HTML file headlessly and return its post-script DOM.
 * @param htmlPath - absolute path of the page to load.
 * @returns the dumped DOM.
 */
function dumpDom(htmlPath) {
  // The browser profile goes to the OS temp directory: Chrome writes tens of
  // megabytes of caches, history and cookie databases into it, none of which
  // belongs in the plugin directory or in version control.
  const profile = join(tmpdir(), 'dsh-smart-ui-render-profile')
  const outFile = join(outDir, 'dom.txt')
  const errFile = join(outDir, 'err.txt')
  const script = `
$p = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--no-first-run',
  '--disable-extensions','--virtual-time-budget=30000',
  '--user-data-dir=${profile.replace(/\\/g, '\\\\')}',
  '--dump-dom', ${JSON.stringify('file:///' + htmlPath.replace(/\\/g, '/'))}
) -Wait -PassThru -NoNewWindow -RedirectStandardOutput ${JSON.stringify(outFile)} -RedirectStandardError ${JSON.stringify(errFile)}
exit $p.ExitCode
`
  try {
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
    })
  } catch (error) {
    // A non-zero exit still leaves the DOM on disk; only a missing file is fatal.
    if (!existsSync(outFile)) throw error
  }
  return readFileSync(outFile, 'utf8')
}

const chunk = readFileSync(join(root, 'client.mermaid.js'), 'utf8')

/** The diagrams a technical answer actually needs. */
const DIAGRAMS = {
  flowchart: `flowchart LR
  A[LoginWindow] -->|Submit| B[ClientApi]
  B -->|Activate| C[DeviceSessionService]
  C -->|POST| D[V4ApiTransport]
  D -->|HTTPS| E[(Server)]
  C -.->|proof=HMAC| E`,

  sequence: `sequenceDiagram
  participant U as User
  participant W as LoginWindow
  participant A as ClientApi
  participant S as DeviceSessionService
  participant T as V4ApiTransport
  U->>W: enter license key
  W->>A: LoginAsync(key)
  A->>S: challenge("login")
  S->>T: POST /auth:challenge
  T-->>S: nonce
  S->>T: POST /auth:login
  T-->>S: identity + token
  S-->>W: DeviceLoginResult
  W->>A: GetScriptsAsync(key)
  A-->>W: ScriptCatalog
  W-->>U: open workspace`,

  classDiagram: `classDiagram
  class DeviceSessionService {
    +LoginAsync(key) DeviceLoginResult
    +RenewAsync() string
    +HeartbeatAsync(state) HeartbeatStatus
    +HasUsableSession(key) bool
  }
  class DeviceTokenStore {
    +Load() DeviceTokenState
    +Save(state)
    +Clear()
  }
  class DeviceTokenState {
    +string KeyHash
    +string DeviceId
    +string Identity
    +string Token
    +DateTimeOffset ExpiresAt
  }
  DeviceSessionService --> DeviceTokenStore : uses
  DeviceTokenStore --> DeviceTokenState : persists`,

  state: `stateDiagram-v2
  [*] --> Anonymous
  Anonymous --> Challenge : click Verify
  Challenge --> Authenticated : proof accepted
  Authenticated --> Renewing : token under 120s
  Renewing --> Authenticated : new token
  Authenticated --> Kicked : 401 or 403
  Kicked --> Anonymous : re-login`,

  er: `erDiagram
  LICENSE ||--o{ DEVICE : binds
  DEVICE ||--|| SESSION : holds
  DEVICE {
    string device_id
    string identity
    string key_hash
  }
  SESSION {
    string token
    datetime expires_at
  }`,

  mindmap: `mindmap
  root((DyWind))
    Core
      DeviceSessionService
      DeviceTokenStore
      V4ApiTransport
    UI
      LoginWindow
      WorkspaceWindow
    Revit
      Application
      OpenWorkspaceCommand`,

  gantt: `gantt
  title Login sequence
  dateFormat X
  axisFormat %s
  section Handshake
  challenge        :a1, 0, 30
  login + proof    :a2, after a1, 60
  section Session
  catalog fetch    :b1, after a2, 40
  workspace open   :b2, after b1, 30`,

  pie: `pie title Session outcomes
  "Authenticated" : 82
  "Kicked" : 12
  "Faulted" : 6`,
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:16px;background:#fff;font-family:system-ui,sans-serif}
h2{font:600 13px system-ui;color:#333;margin:0 0 8px}
figure{margin:0 0 22px}svg{max-width:100%;height:auto}</style>
</head><body>
<div id="root"></div>
<script>window.__pending=[];window.__ModuleLoader__={load:function(r){window.__pending.push(r)}};</script>
<script>${chunk}</script>
<script>
var DIAGRAMS = ${JSON.stringify(DIAGRAMS)};
(async function () {
  var results = { leaked: null, ok: {}, failed: {} };
  try {
    var reg = window.__pending[0];
    var api = reg.factory(function () { throw new Error('chunk must not require anything') });
    results.leaked = Object.prototype.hasOwnProperty.call(window, 'mermaid');
    api.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'strict',
      themeVariables: { fontFamily: 'system-ui, sans-serif', fontSize: '13px' },
    });
    var root = document.getElementById('root');
    var names = Object.keys(DIAGRAMS);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      try {
        var out = await api.render('d_' + name, DIAGRAMS[name]);
        var fig = document.createElement('figure');
        var cap = document.createElement('h2');
        cap.textContent = name;
        fig.appendChild(cap);
        fig.insertAdjacentHTML('beforeend', out.svg);
        root.appendChild(fig);
        results.ok[name] = out.svg.length;
      } catch (e) {
        results.failed[name] = String((e && e.message) || e);
      }
    }
  } catch (e) {
    results.fatal = String((e && e.stack) || e);
  }
  document.title = 'RESULT:' + JSON.stringify(results);
})();
</script></body></html>`

const htmlPath = join(outDir, 'render.html')
writeFileSync(htmlPath, html, 'utf8')

const dom = dumpDom(htmlPath)
writeFileSync(join(outDir, 'rendered.html'), dom, 'utf8')

const title = dom.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
if (!title.startsWith('RESULT:')) {
  console.error('FAIL: the page did not report a result; first 500 chars of <title>:')
  console.error(title.slice(0, 500))
  process.exit(1)
}

const decoded = title.slice('RESULT:'.length)
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const result = JSON.parse(decoded)

if (result.fatal) {
  console.error('FATAL:', result.fatal)
  process.exit(1)
}

console.log(`chunk leaked a global: ${result.leaked}   (must be false)\n`)
const okNames = Object.keys(result.ok)
const failNames = Object.keys(result.failed)
for (const name of okNames) console.log(`ok    ${name.padEnd(12)} ${String(result.ok[name]).padStart(7)} B svg`)
for (const name of failNames) console.log(`FAIL  ${name.padEnd(12)} ${result.failed[name]}`)

console.log(`\n${okNames.length}/${okNames.length + failNames.length} diagram types rendered`)
console.log(`page: ${htmlPath}`)

if (result.leaked) { console.error('\nFAIL: mermaid leaked onto window'); process.exit(1) }
if (failNames.length > 0) { console.error(`\nFAIL: ${failNames.length} diagram type(s) did not render`); process.exit(1) }
console.log('OK: every diagram type rendered, no global leaked')
