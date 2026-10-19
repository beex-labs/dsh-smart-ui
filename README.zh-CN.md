[English](README.md) | **简体中文**

# dsh-intelligent-ui

给 DSH 对话的生成式 UI。模型调用一个工具 `ui_render`，只写一份 JSON UI Schema，页面就渲染出活的、与状态绑定的交互界面：表单、KPI、图表、表格由共享状态联动，还有微应用、地图和流式生长。同一个工具也渲染十种固定卡片（回答是单一静态结构时），以及供人使用的 Schema 调试台。

模型只写**数据，不写 HTML/JSX/JavaScript**。规格是纯 JSON，进会话记录、fork、resume 之后原样重绘。绑定表达式跑在手写的安全表达式语言里（没有 `eval`，函数表固定），状态变更走 Action Router——只汇报真正发生的副作用，语义 tone 解析成主题变量，明暗两套主题都正确。

## 两套词汇表

**固定卡片** —— 回答是一个静态结构时用，即时渲染、无状态：

| `kind` | 用在什么时候 | 主要字段 |
|--------|-------------|---------|
| `compare` | 三件以上的东西在同一组标准下比较 | `columns`、`rows[{label, cells[]}]` |
| `chart` | 一组数量级（`bar`）、有序趋势（`line`）、整体的构成（`pie` / `donut`） | `series[{label, value, tone?, hint?}]`、`variant`、`unit` |
| `stats` | 二到六个头条数字 | `stats[{label, value, tone?, hint?}]` |
| `progress` | 一个比例，比如通过率、配额用量 | `value`、`max`、`label`、`unit`、`tone` |
| `steps` | 三步以上的有序流程 | `steps["text" \| {text, detail?}]` |
| `table` | 一行行的记录 | `columns`、`rows[][]` |
| `diagram` | 用箭头连起来的方框，或任意 Mermaid 图族 | `nodes[{id, label, detail?, tone?}]` + `edges[{from, to, label?}]` + `layout`，或直接给 `mermaid` |
| `calculator` | 用户会拿自己的数字重算的算式 | `mode: split \| tip`、`fields[{label, value, min?, max?}]` |
| `unit` | 单位换算 | `units`、`factors?`、`from`、`to`、`value` |
| `note` | 一件不能错过的事 | `text`、`tone` |

**生成式 UI** —— `kind: "app"`，交互词汇表：

| `kind` | 用在什么时候 | 主要字段 |
|--------|-------------|---------|
| `app` | 用户会调整、并看着数字实时变化的交互工具、模拟器、仪表盘 | `state`、`compute`、`tree`（`{id, type, props, bind, on, children}`）、`stream` |
| `playground` | 可编辑的 JSON UI Schema，实时校验与预览 | `source`（JSON 文本；坏 schema 是预期内的输入，会在卡片里显示错误） |

一个 `app` 是一棵组件树，取自 71 种注册组件（含 6 个图表别名共 77 个名字；文本、布局、控件、图表、表格、地图、媒体、反馈，以及 `quiz` / `flashcard` / `countdown` 微应用），用 `bind` 表达式读 `state` + `compute`、用 `on` 动作（`set`、`toggle`、`copy`、`open`、`submit`、`call`）连起来。一个输入变化，所有依赖它的 KPI、图表、表格同时更新。

## 工作方式

```text
模型写 spec（纯 JSON）
   ↓
index.js      宿主一半：ui_render 工具 + 一段提示词；
              normalizeSpec（固定卡片）与节点预算
   ↓
engine.cjs    共享一半：组件注册表、安全表达式语言、
              validateApp、computeAll/resolveProps、planAction、
              流式协议——两端跑同一份代码
              （build-engine.mjs 把它包成 client.engine.js）
   ↓
client.js     客户端一半：渲染进 tool.call.toolview 槽位——
              固定卡片、app 运行时（状态、动作、toast）、
              71 组件 REGISTRY、Mock Streaming、Schema 调试台
```

- **宿主一半**（`index.js`）：工具 schema 和提示词与校验器放在一起；结构化 `diagram` 在宿主侧就编译成 Mermaid 源码，会话记录里存的就是画出来的那张图。
- **共享引擎**（`engine.cjs`，刻意写成 CommonJS）：宿主 `import` 它，客户端加载 `client.engine.js`。两端校验、求值用同一份代码——不可能漂移。
- **客户端一半**（`client.js`）：所有视觉。图表和流程图走 ECharts / Mermaid 懒加载 chunk（`client.echarts.js` / `client.mermaid.js`，生成物、不进 git）；其余是主题变量上的纯 React。

细节见 [docs/architecture.md](docs/architecture.md)、[docs/schema.md](docs/schema.md)、[docs/components.md](docs/components.md)。

### 跟随字体大小

DSH 的主题呈现器把用户的正文字号写到 `document.body` 的 `--dsh-content-font-size`（10–22px），每次变化发 `theme/change`。样式规则写成 `calc(<authored size> + var(--iui-fs-delta))`，一次写入整卡缩放；ECharts 和 Mermaid 从同一个变量取真实 px 数值，并有下限，保证最小的标签仍然可读。

### 表格溢出

列数不限——宽表横向滚动。行数上限 15 行：超过后表格内部纵向滚动、表头固定。上限按行数算而不是像素高度，所以任何字号下都还是 15 行。

## 快速开始

### 构建

三个 chunk 是**生成物**、不进 git。装完依赖后必须构建，否则图表退化成纯文本摘要、app 加载不到引擎：

```bash
pnpm install
node build-engine.mjs && node build-echarts.mjs && node build-mermaid.mjs
```

脚本把源码包进 DSH 的模块加载器外壳：`engine.cjs` 原样；ECharts 取 UMD 的 `exports` 分支（不泄漏全局）；Mermaid 截获它赋给 `globalThis` 的 API 再删掉全局。

### 装进 DSH profile

把本仓库放进 DSH profile 依赖里（本地 `link:` 或直接指向 GitHub 仓库都行）：

```json
{
  "dependencies": { "dsh-intelligent-ui": "link:<此目录绝对路径>" },
  "dsh": { "profile": { "bundles": ["dsh-intelligent-ui"] } }
}
```

profile 的 `cordis.patch.yml` 插入插件行：

```yaml
- insert:
    - id: intelligent-ui
      name: 'dsh-intelligent-ui'
```

然后安装依赖：

```bash
cd "$DSH_PROFILE_DIR"
pnpm install --no-frozen-lockfile
```

## 演示

七个可运行的 app spec 在 [`demos/`](demos) 里——完整说明见 [docs/demos.md](docs/demos.md)。每个文件是去掉 `kind` 外层的 `app` spec；包一层 `{"spec": {"kind": "app", …}}`，或粘进 `playground` 卡片的 `source` 即可运行。

| 文件 | 场景 | 看点 |
|------|------|------|
| `demos/1-travel.json` | 京都旅行规划助手 / Kyoto trip planner | 联动的 `map` + `places` 选点、花费环图、行程表 |
| `demos/2-analytics.json` | 销售分析仪表盘 / sales analytics dashboard | KPI 行、segmented 切换的面积图、可搜索/筛选/导出的 `dataTable` |
| `demos/3-invest.json` | 理财复利模拟器 / compound-interest simulator | 输入 → KPI → 折线图 → 进度条，外加一个如实报「not connected」的 `call` 动作 |
| `demos/4-learn.json` | 勾股定理互动讲解 / Pythagoras theorem lesson | 白名单形状的 SVG 三角形、`math` 公式子集、tabs、记忆卡 |
| `demos/5-split.json` | AA 分账计算器 / bill split | compute + 环图 + 人均表、`expr` 的 `copy`、`form` + `submit` |
| `demos/6-quiz.json` | 世界地理问答闯关 / geography quiz | `quiz` 微应用、分数写回状态（`on.change` expr）、通过后徽章翻转 |
| `demos/7-stream.json` | 流式渲染演示 · 服务负载看板 / streaming service-load dashboard | Mock Streaming（`stream: {mode: "mock"}`）渐进生长 |

## 测试

```bash
node test/engine.mjs           # 引擎契约：表达式、校验、动作、流式（65 项检查）
node test/normalize.mjs        # 固定卡片归一化：每种 kind 的正常路径 + 防御（54 项检查）
node test/echarts-chunk.mjs    # 不用浏览器验证生成的 ECharts chunk 可加载
node test/render-svg.mjs       # ECharts SSR 渲染图表到 test/out，供人眼检查
node test/render-mermaid.mjs   # 无头渲染 Mermaid 各图族到 test/out-mermaid
node test/shot-mermaid.mjs     # Chrome 截图（Mermaid 文字是 foreignObject HTML）
node test/font-and-overflow.mjs# 无头量：字号跟随、宽表横滑、15 行上限
node test/font-live.mjs        # 改字号后已挂载卡片（含图表）即时重绘
node test/shot-font.mjs        # 10/14/22px 三档截图到 test/out-font
node test/app-render.mjs       # 真浏览器里渲染 app 引擎
node test/app-interaction.mjs  # 真浏览器里测 Action Router 交互
node test/shot-app.mjs         # app 截图，供人眼检查
node demos/check.mjs           # 用 validateApp 校验 demos/ 下全部 *.json
```

浏览器类脚本会在 Windows 默认安装路径找 Chrome/Edge，并在真实布局引擎里量 computed style（断言看不出这些行为）。逐脚本的测试报告见 [docs/testing.md](docs/testing.md)。

## 有意设定的限制

| 限制 | 值 | 原因 |
|------|----|------|
| 一棵 `app` 树的节点数 | 400（`apply(ctx, { maxNodes })` 可调） | 失控的模型不能卡死页面 |
| 树嵌套深度 | 8 层（含根） | 可读性与渲染成本 |
| `state` 大小 | 序列化后 49 152 字节 | 它存在会话记录里 |
| 单个字符串值 | 12 000 字符 | 一个 prop 不能吃掉整张卡 |
| 单个 spec | 200 000 JSON 字符 | 整体载荷预算 |
| 单条表达式 | 2 000 字符、32 层嵌套 | 绑定是公式，不是程序 |
| 表达式词汇 | 函数表固定；无 `eval`、无用户函数、无赋值 | 模型写的 JSON 永远执行不了 JavaScript |
| 原始 `mermaid` 源码 | 12 000 字符 | 一张图不能吃掉整个页面 |
| `diagram` 两种写法 | `mermaid` 与 `nodes`+`edges` 二选一 | 两条路径不会对不上 |
| 表格内滚动前的行数 | 15 | 长表格滚动，不撑长页面 |

## 什么是真的、什么是占位

| 机制 | 状态 |
|------|------|
| 71 种组件（含别名 77 个名字）的渲染、嵌套、`hidden` / `span` | **真实** |
| 状态绑定（`bind`）、`compute` 推导、一输入→多视图重绘 | **真实** |
| 动作 `set`、`toggle`、`copy`（Clipboard API）、`open`（`window.open` + 弹窗拦截检测）、`submit` | **真实** —— 只有副作用真的发生了才报成功 |
| `dataTable` 排序 / 搜索 / 筛选 / 分页 / 选择 / CSV 导出 | **真实**（视图内本地） |
| 流式协议机制（序号、去重、乱序修复、`stream.error` + `retry()` 断点续传）与 Mock Streaming 重放 | **真实** |
| 外部服务 `call` | **占位** —— 不预装任何服务，`call` 明确报 *「service … is not connected」*，绝不假成功。接入点：`useAppRuntime` 里的 `services` 注册表（见 [docs/architecture.md](docs/architecture.md)） |
| 真实 LLM SSE 流式 | **预留** —— `createSseSource` 是接入点，在配置后端端点前拒绝连接并说明原因 |
| `map` | **示意图** —— 把声明的地点做等距圆柱投影到 SVG 平面（真实数学，不依赖瓦片服务）。不用 MapLibre/Leaflet：两者都需要联网瓦片服务、且在聊天卡片里体积过大；瓦片地图日后可在同一节点类型后替换 |
| `math` | **公式子集** —— `x^2`、`x_i`、`\frac{a}{b}`、`\sqrt{x}`，其余退化为纯文本。不用 KaTeX：它的渲染器需要 20 多个 woff2 字体文件，插件路由送不了 |
| `markdown` | **安全子集** —— 标题、列表、引用、围栏代码、行内粗体/斜体/代码/链接，渲染成 React 元素；绝不生成 HTML |
| `fileUpload` | **只有元数据** —— 动作收到文件名和大小，不做任何传输（没有上传后端） |

各组件的行为与边界情况见 [docs/components.md](docs/components.md)。

## 致谢

感谢为本项目做出贡献的人：

[<img src="https://github.com/windzxy.png?size=80" width="80" alt="@windzxy">](https://github.com/windzxy) [<img src="https://github.com/anyiba.png?size=80" width="80" alt="@anyiba">](https://github.com/anyiba)

## 许可证

MIT，见 [LICENSE](LICENSE)。

仓库本身不含图表库的代码（生成的 chunk 被 `.gitignore` 排除），构建时从 npm 取：ECharts 采用 Apache License 2.0，Mermaid 采用 MIT。
