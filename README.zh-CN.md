[English](README.md) | **简体中文**

# dsh-smart-ui

给 DSH 的对话加上结构化 UI 卡片。模型调用 `ui_render` 工具，只写一份 JSON 数据，页面把它渲染成交互卡片：对比表、图表、头条数字、步骤、表格、可改数字的计算工具、单位换算、流程图。

回答里常出现"真正的结构"——三项以上的对比、一组数量级、几个头条数字、有序步骤、行列表格、用户想改数字重算的算式。这些用纯文字描述既费 token 又难读。本插件让模型把结构交给卡片，文字只留结论。

- **模型只写数据，不写 HTML/JSX**：规格是纯 JSON，进会话记录，fork、resume 之后原样重绘。
- **卡片是工具参数的纯函数**：不向宿主取任何状态，重载、续聊得到的都是同一张卡。
- **明暗两套主题**：规格里只有语义 tone（`success` / `warn` …），客户端把 tone 解析成主题变量，模型永远不写具体颜色。

## 卡片类型

| `kind` | 用在什么时候 | 主要字段 |
|--------|-------------|---------|
| `compare` | 三件以上的东西在同一组标准下比较 | `columns`、`rows[{label, cells[]}]` |
| `chart` | 一组数量级（`bar`）、有序趋势（`line`）、整体的构成（`pie` / `donut`） | `series[{label, value, tone?, hint?}]`、`variant`、`unit` |
| `stats` | 二到六个头条数字 | `stats[{label, value, tone?, hint?}]` |
| `progress` | 一个比例，比如通过率、配额用量 | `value`、`max`、`label`、`unit`、`tone` |
| `steps` | 三步以上的有序流程 | `steps["text" \| {text, detail?}]` |
| `table` | 一行行的记录 | `columns`、`rows[][]` |
| `diagram` | 用箭头连起来的方框：流程、决策树、层级、依赖、类图 | `nodes[{id, label, detail?, tone?}]` + `edges[{from, to, label?}]` + `layout`，或直接给 `mermaid` 源码 |
| `calculator` | 用户会拿自己的数字重算的算式：AA 付账、小费 | `mode: split \| tip`、`fields[{label, value, min?, max?}]` |
| `unit` | 单位换算 | `units`、`factors?`、`from`、`to`、`value` |
| `note` | 一件不能错过的事 | `text`、`tone` |

每种卡片都接受 `title`（标题）和 `caption`（脚注）。

`diagram` 有两种写法：结构化的 `nodes` + `edges`（编译成 Mermaid flowchart，`layout: "tree"` 表示自上而下的层级）或完整的 `mermaid` 源码（时序图、状态机、甘特图、ER 图等全部图族）。两者只能选一个。

## 工作方式

```text
模型写 spec（纯 JSON）
   ↓
index.js   注册 ui_render 工具 + 一段提示词：校验规格、归一化、超限报错回模型
   ↓
client.js  在 tool.call.toolview 槽位渲染卡片
```

- `index.js` 是宿主一半：工具 schema、规格校验（`normalizeSpec`）、Mermaid 源码编译都在这里，保证会话记录里存的就是画出来的那张图。
- `client.js` 是客户端一半：`compare` / `stats` / `steps` / `table` / `note` / `calculator` / `unit` 是纯 React，`progress` 是内联 SVG，`chart` 走 ECharts，`diagram` 走 Mermaid。
- 图表库**按需加载**：`client.echarts.js` / `client.mermaid.js` 是生成出来的懒加载 chunk，第一次画图时才拉，且不进 git。

## 安装

把本仓库放进 DSH profile 依赖里（本地 `link:` 或直接指向 GitHub 仓库都行）：

```json
{
  "dependencies": { "dsh-smart-ui": "link:<此目录绝对路径>" },
  "dsh": { "profile": { "bundles": ["dsh-smart-ui"] } }
}
```

profile 里的 `cordis.patch.yml` 插入插件行：

```yaml
- insert:
    - id: smart-ui
      name: 'dsh-smart-ui'
```

然后安装依赖：

```bash
cd "$DSH_PROFILE_DIR"
pnpm install --no-frozen-lockfile
```

## 构建

两个图表 chunk 是**生成物**，git 不跟踪。装完依赖后必须先构建，否则图表会退化成纯文本摘要：

```bash
pnpm install
node build-echarts.mjs     # 生成 client.echarts.js
node build-mermaid.mjs     # 生成 client.mermaid.js
```

脚本把 npm 包的发行文件包进 DSH 的模块加载器外壳：ECharts 取 UMD 的 `exports` 分支（不泄漏全局），Mermaid 截获它赋给 `globalThis` 的 API 再删掉全局。

## 测试

```bash
node test/normalize.mjs      # 规格归一化自检：每种 kind 的正常路径 + 防御路径
node test/echarts-chunk.mjs  # 不用浏览器验证生成的 chunk 能加载出可用的 ECharts
node test/render-svg.mjs     # ECharts SSR 渲染图表/流程图到 test/out，供人眼检查
node test/render-mermaid.mjs # 无头浏览器渲染 Mermaid 各图族到 test/out-mermaid
node test/shot-mermaid.mjs   # Chrome 截图（Mermaid 的文字是 foreignObject，只能靠真浏览器）
```

后两个脚本会找 Chrome / Edge（Windows 默认安装路径）。

## 有意设定的限制

| 限制 | 值 | 原因 |
|------|----|------|
| 一个 spec 的节点数 | 400（`apply(ctx, { maxNodes })` 可调） | 失控的模型不能卡死页面 |
| 原始 `mermaid` 源码长度 | 12000 字符 | 一张图不能吃掉整个页面 |
| `diagram` 的两种写法 | 二选一 | 两条路径不会对不上 |

## 致谢

感谢为本项目做出贡献的人：

[<img src="https://github.com/windzxy.png?size=80" width="80" alt="@windzxy">](https://github.com/windzxy) [<img src="https://github.com/anyiba.png?size=80" width="80" alt="@anyiba">](https://github.com/anyiba)

## 许可证

MIT，见 [LICENSE](LICENSE)。

仓库本身不含图表库的代码（生成的 chunk 被 `.gitignore` 排除），构建时从 npm 取：ECharts 采用 Apache License 2.0，Mermaid 采用 MIT。
