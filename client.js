/**
 * Intelligent UI — Client half.
 *
 * Registers one view in the keyed `tool.call.toolview` slot under the wire name
 * `ui_render`, so every call renders as an interactive card in the conversation
 * flow instead of a generic tool row.
 *
 * The card is a pure function of the tool arguments: it reads `block` (the
 * dispatched call, whose `argsRaw` holds the normalized spec the Host accepted)
 * and renders. Nothing is fetched from the Host and no state outlives the
 * component, so a reload, a fork, and a resume all redraw the same card from the
 * session log.
 *
 * Charts and diagrams render through Apache ECharts, loaded lazily as the
 * sibling chunk `client.echarts.js` (see build-echarts.mjs). Everything else is
 * plain React over theme tokens, so light and dark both work.
 */

window.__ModuleLoader__.load({
  id: 'dsh-intelligent-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useMemo, useEffect, useRef, useCallback, useContext, useReducer } = React

    const NS = 'intelligent-ui'
    const PKG = 'dsh-intelligent-ui'

    /** The only static UI text this plugin owns; every other string is model data. */
    const DICTS = {
      en: {
        preparing: 'Preparing card…', unsupported: 'Unsupported card', rendering: 'Rendering chart…',
        chartFailed: 'Chart library unavailable — showing a plain summary.',
        amount: 'Amount', from: 'From', to: 'To', convertFrom: 'Convert from', convertTo: 'Convert to', slider: 'slider',
        of: 'of', table: 'Table',
        streaming: 'Streaming…', streamDone: 'Stream complete', streamError: 'Stream failed', replay: 'Replay',
        retry: 'Retry', copy: 'Copy', copied: 'Copied to clipboard', copyFailed: 'Copy failed',
        openBlocked: 'The browser blocked the new window', submitted: 'Submitted',
        missing: 'Missing required fields', notConnected: 'not connected', serviceFailed: 'Service call failed',
        reset: 'Reset', next: 'Next', prev: 'Previous', close: 'Close', flip: 'Flip', showAnswer: 'Show answer',
        score: 'Score', question: 'Question', empty: 'Nothing here yet',
        bindError: 'Binding error', nodeError: 'This component failed to render', unknownType: 'Unknown component',
        playgroundTitle: 'Schema Playground', playgroundHint: 'Edit the JSON, then Apply to validate and preview.',
        invalidJson: 'Invalid JSON', valid: 'Schema is valid', apply: 'Apply', search: 'Search', filter: 'Filter',
        page: 'Page', rowsSelected: 'selected', export: 'Export CSV', loading: 'Loading…',
        pause: 'Pause', start: 'Start', expires: 'Time is up', sort: 'Sort', noResults: 'No matches',
        upload: 'Choose files', submit: 'Submit', confirm: 'Confirm', cancel: 'Cancel', step: 'Step',
        all: 'All',
        imageFailed: 'Image failed to load', slide: 'Slide', on: 'on', off: 'off',
      },
      zh: {
        preparing: '正在准备卡片…', unsupported: '不支持的卡片', rendering: '正在渲染图表…',
        chartFailed: '图表库不可用——改为纯文本摘要。',
        amount: '数值', from: '从', to: '到', convertFrom: '转换自', convertTo: '转换为', slider: '滑块',
        of: '/', table: '表格',
        streaming: '流式接收中…', streamDone: '流式完成', streamError: '流式中断', replay: '重放',
        retry: '重试', copy: '复制', copied: '已复制到剪贴板', copyFailed: '复制失败',
        openBlocked: '浏览器拦截了新窗口', submitted: '已提交',
        missing: '缺少必填项', notConnected: '未接入', serviceFailed: '服务调用失败',
        reset: '重置', next: '下一步', prev: '上一步', close: '关闭', flip: '翻面', showAnswer: '显示答案',
        score: '得分', question: '题目', empty: '暂无内容',
        bindError: '绑定错误', nodeError: '该组件渲染失败', unknownType: '未知组件',
        playgroundTitle: 'Schema 调试台', playgroundHint: '编辑 JSON 后点击「应用」查看校验结果与实时预览。',
        invalidJson: 'JSON 无效', valid: 'Schema 校验通过', apply: '应用', search: '搜索', filter: '筛选',
        page: '页', rowsSelected: '已选', export: '导出 CSV', loading: '加载中…',
        pause: '暂停', start: '开始', expires: '时间到', sort: '排序', noResults: '无匹配结果',
        upload: '选择文件', submit: '提交', confirm: '确认', cancel: '取消', step: '步骤',
        all: '全部',
        imageFailed: '图片加载失败', slide: '幻灯片', on: '开', off: '关',
      },
    }

    /** Semantic tone → theme token. A spec never carries a literal color. */
    const TONE_TOKEN = {
      neutral: '--dsw-alias-state-idle-primary',
      info: '--dsw-alias-brand-primary',
      success: '--dsw-alias-state-success-primary',
      warn: '--dsw-alias-state-warn-primary',
      error: '--dsw-alias-state-error-primary',
    }

    /**
     * Opacity steps for an untoned categorical series. The theme exposes five
     * semantic colors and none of them means "category 3", so plain data cycles
     * the brand color at decreasing opacity instead — theme-correct in both
     * schemes, and it never implies a status the data does not have.
     */
    const PALETTE_ALPHA = [1, 0.72, 0.52, 0.38, 0.27, 0.19, 0.13, 0.09]

    /**
     * Follow the user's content font size.
     *
     * The theme presenter publishes the setting as `--dsh-content-font-size` on
     * `document.body` (10–22px, default 14px) and re-emits `theme/change` on
     * every change, so binding to that one variable keeps every string in a card
     * — and the ECharts/Mermaid text, which needs the same value as a number —
     * in step with the rest of the conversation.
     *
     * The card's scale was authored against the 14px default. `fontStyle()` sets
     * the setting plus `--iui-fs-delta`, its offset from that default, and every
     * rule below is written as `calc(<authored size> + var(--iui-fs-delta))`. So
     * the card keeps its own proportions while the small print moves with the
     * body text instead of staying pinned while everything around it grows.
     */
    const FONT_VAR = '--dsh-content-font-size'
    const FONT_BASE = 14
    /**
     * Smallest size a chart step is allowed to reach.
     *
     * The setting bottoms out at 10px, which would drag an 11px axis label to
     * 7px: smaller than DSH's own minimum text. Clamping keeps the smallest
     * steps legible while everything above them still follows the setting.
     */
    const FONT_FLOOR = 9

    const CSS = `
.iui-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:14px;font-size:calc(13px + var(--iui-fs-delta, 0px));color:var(--dsw-alias-label-primary);line-height:1.5;overflow:hidden}
.iui-title{font-weight:600;margin-bottom:10px;font-size:calc(13px + var(--iui-fs-delta, 0px))}
.iui-caption{margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
/* Columns are unbounded: a wide table scrolls sideways only once it really
   overflows. Rows are capped so a long one cannot push the card off-screen; the
   cap is a row count, so its height is expressed in rows, not pixels. */
.iui-scroll{overflow-x:auto;overflow-y:hidden}
.iui-scroll-y{max-height:calc(var(--iui-table-rows, 15) * var(--iui-row-h));overflow-y:auto;overflow-x:auto}
.iui-scroll-y:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iui-table{border-collapse:collapse;width:100%;font-size:calc(12.5px + var(--iui-fs-delta, 0px))}
/* One row's height is fixed rather than derivable: an explicit line-height plus
   the padding and border below sum to exactly --iui-row-h, so multiplying it by
   15 really does show 15 rows. A bare height on a cell is only a minimum in
   table layout, which is why the row box is built from the parts instead. */
.iui-table th,.iui-table td{text-align:left;padding:var(--iui-row-pad) 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;line-height:var(--iui-row-line)}
.iui-table th{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:calc(12px + var(--iui-fs-delta, 0px))}
/* A sticky header keeps the columns readable while the rows scroll under it. */
.iui-table thead th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1)}
.iui-table tr:last-child td{border-bottom:none}
.iui-table td.iui-num{font-variant-numeric:tabular-nums}
.iui-rowhead{color:var(--dsw-alias-label-secondary);font-weight:600}
.iui-chart{display:flex;flex-direction:column;gap:6px}
.iui-bar-row{display:grid;grid-template-columns:minmax(72px,26%) 1fr auto;align-items:center;gap:10px}
.iui-bar-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iui-bar-track{background:var(--dsw-alias-bg-layer-2);border-radius:4px;height:16px;overflow:hidden}
.iui-bar-fill{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary);min-width:2px;transition:width .18s ease}
.iui-bar-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.iui-stat{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:10px;border-left:3px solid transparent}
.iui-stat-value{font-size:calc(20px + var(--iui-fs-delta, 0px));font-weight:600;font-variant-numeric:tabular-nums}
.iui-stat-label{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px));margin-top:2px}
.iui-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.iui-step{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start}
.iui-step-n{width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;font-size:calc(11.5px + var(--iui-fs-delta, 0px));font-weight:600}
.iui-step-detail{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px));margin-top:2px}
.iui-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.iui-field{display:flex;flex-direction:column;gap:4px}
.iui-field span{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums}
.iui-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:var(--dsw-alias-brand-primary)}
.iui-range{width:100%;accent-color:var(--dsw-alias-brand-primary)}
.iui-result{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:6px}
.iui-result-row{display:flex;justify-content:space-between;gap:12px}
.iui-result-row b{font-variant-numeric:tabular-nums}
.iui-total{border-top:1px solid var(--dsw-alias-border-l1);padding-top:6px;font-weight:600}
.iui-note{display:flex;gap:10px;align-items:flex-start;border-left:3px solid var(--dsw-alias-brand-primary);padding:10px 12px;background:var(--dsw-alias-bg-layer-2);border-radius:0 8px 8px 0}
.iui-note-warn{border-left-color:var(--dsw-alias-state-warn-primary)}
.iui-note-success{border-left-color:var(--dsw-alias-state-success-primary)}
.iui-note-error{border-left-color:var(--dsw-alias-state-error-primary)}
.iui-note-neutral{border-left-color:var(--dsw-alias-state-idle-primary)}
.iui-empty{color:var(--dsw-alias-label-secondary)}
.iui-progress{display:flex;align-items:center;gap:16px}
.iui-ring{flex:none}
.iui-ring-track{stroke:var(--dsw-alias-bg-layer-2)}
.iui-ring-value{transition:stroke-dashoffset .3s ease}
.iui-ring-num{font-size:calc(22px + var(--iui-fs-delta, 0px));font-weight:600;font-variant-numeric:tabular-nums;fill:var(--dsw-alias-label-primary)}
.iui-ring-unit{font-size:calc(11px + var(--iui-fs-delta, 0px));fill:var(--dsw-alias-label-secondary)}
.iui-progress-body{min-width:0}
.iui-progress-label{font-weight:600}
.iui-progress-sub{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px));margin-top:2px}
.iui-canvas{width:100%}
.iui-mermaid{width:100%;overflow-x:auto;text-align:center}
.iui-mermaid svg{max-width:100%;height:auto}
.iui-mmd-error{margin:8px 0 0;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:calc(11px + var(--iui-fs-delta, 0px))/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-x:auto}
/* ── generative app: layout, controls, data, media, feedback ───────────── */
.iui-app{display:flex;flex-direction:column;gap:12px}
.iui-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.iui-col{display:flex;flex-direction:column;gap:10px;min-width:0}
.iui-flow{display:flex;flex-wrap:wrap;gap:10px}
.iui-grid{display:grid;gap:10px}
.iui-bento{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.iui-span-2{grid-column:span 2}
.iui-span-3{grid-column:span 3}
.iui-divider{border-top:1px solid var(--dsw-alias-border-l1);margin:4px 0}
.iui-divider-label{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-divider-label:before,.iui-divider-label:after{content:'';flex:1;border-top:1px solid var(--dsw-alias-border-l1)}
.iui-card2{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:8px}
.iui-card2-title{font-weight:600}
.iui-card2-sub{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-card2-accent{border-left:3px solid var(--dsw-alias-brand-primary)}
.iui-btn{display:inline-flex;align-items:center;gap:6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:6px 12px;font:inherit;font-size:calc(12.5px + var(--iui-fs-delta, 0px));cursor:pointer;min-height:30px}
.iui-btn:hover{border-color:var(--dsw-alias-brand-primary)}
.iui-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iui-btn[disabled]{opacity:.55;cursor:not-allowed}
.iui-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.iui-btn-ghost{background:transparent}
.iui-btn-full{width:100%;justify-content:center}
.iui-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.iui-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iui-field2{display:flex;flex-direction:column;gap:4px;min-width:0}
.iui-field2>span{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-help{color:var(--dsw-alias-label-secondary);font-size:calc(11.5px + var(--iui-fs-delta, 0px))}
.iui-check{display:flex;align-items:center;gap:8px}
.iui-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.iui-seg button{border:none;background:transparent;padding:5px 12px;font:inherit;font-size:calc(12.5px + var(--iui-fs-delta, 0px));cursor:pointer;color:var(--dsw-alias-label-secondary);min-height:30px}
.iui-seg button[aria-pressed='true']{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.iui-tabs{display:flex;flex-direction:column;gap:8px}
.iui-tablist{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}
.iui-tablist button{border:none;background:transparent;padding:6px 12px;font:inherit;font-size:calc(12.5px + var(--iui-fs-delta, 0px));cursor:pointer;color:var(--dsw-alias-label-secondary);border-bottom:2px solid transparent;white-space:nowrap}
.iui-tablist button[aria-selected='true']{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.iui-acc{display:flex;flex-direction:column;gap:6px}
.iui-acc-item{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.iui-acc-head{width:100%;text-align:left;display:flex;justify-content:space-between;gap:10px;align-items:center;border:none;background:transparent;padding:8px 12px;font:inherit;cursor:pointer;color:var(--dsw-alias-label-primary)}
.iui-acc-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.iui-acc-body{padding:0 12px 10px}
.iui-pop{position:relative;display:inline-flex}
.iui-pop-panel{position:absolute;z-index:20;top:calc(100% + 6px);left:0;min-width:220px;max-width:340px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.iui-tip-wrap{position:relative;display:inline-flex}
.iui-tip{position:absolute;z-index:20;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-radius:6px;padding:4px 8px;font-size:calc(11.5px + var(--iui-fs-delta, 0px))}
.iui-carousel{display:flex;flex-direction:column;gap:8px}
.iui-carousel-frame{position:relative;overflow:hidden;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);min-height:120px;display:flex;align-items:center;justify-content:center}
.iui-carousel-nav{display:flex;align-items:center;justify-content:space-between;gap:10px}
.iui-dots{display:flex;gap:6px}
.iui-dot{width:8px;height:8px;border-radius:50%;border:none;background:var(--dsw-alias-border-l2);cursor:pointer;padding:0}
.iui-dot[aria-current='true']{background:var(--dsw-alias-brand-primary)}
.iui-kpi{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.iui-kpi-value{font-size:calc(20px + var(--iui-fs-delta, 0px));font-weight:600;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:6px}
.iui-kpi-unit{font-size:calc(12px + var(--iui-fs-delta, 0px));color:var(--dsw-alias-label-secondary);font-weight:400}
.iui-kpi-label{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-kpi-delta{font-size:calc(11.5px + var(--iui-fs-delta, 0px))}
.iui-progress-bar{height:10px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.iui-progress-fill{height:100%;border-radius:5px;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.iui-table-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.iui-table-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-table input[type='checkbox']{accent-color:var(--dsw-alias-brand-primary)}
.iui-sort{cursor:pointer;user-select:none;white-space:nowrap}
.iui-sort:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iui-gallery{display:grid;gap:10px}
.iui-thumb{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;cursor:zoom-in;padding:0;background:transparent;display:block;width:100%}
.iui-thumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iui-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.iui-img-fallback{border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:16px;text-align:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.iui-lightbox{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px}
.iui-lightbox img{max-width:100%;max-height:80vh;border-radius:8px}
.iui-lightbox-bar{display:flex;gap:10px;align-items:center;color:#fff}
.iui-map{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);display:block}
.iui-map-marker{cursor:pointer}
.iui-map-marker:focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}
.iui-places{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.iui-place{display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-base);cursor:pointer;text-align:left;font:inherit;color:inherit;width:100%}
.iui-place[aria-current='true']{border-color:var(--dsw-alias-brand-primary)}
.iui-place:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.iui-toast-stack{position:sticky;top:0;z-index:30;display:flex;flex-direction:column;gap:6px}
.iui-toast-item{display:flex;justify-content:space-between;gap:10px;align-items:center;border-radius:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2);border-left:3px solid var(--dsw-alias-brand-primary)}
.iui-toast-item[data-tone='error']{border-left-color:var(--dsw-alias-state-error-primary)}
.iui-toast-item[data-tone='success']{border-left-color:var(--dsw-alias-state-success-primary)}
.iui-toast-item[data-tone='warn']{border-left-color:var(--dsw-alias-state-warn-primary)}
.iui-skeleton{border-radius:6px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2) 25%,var(--dsw-alias-bg-base) 50%,var(--dsw-alias-bg-layer-2) 75%);background-size:200% 100%;animation:iui-shimmer 1.4s infinite}
@keyframes iui-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.iui-spinner{width:18px;height:18px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:iui-spin .8s linear infinite;display:inline-block}
@keyframes iui-spin{to{transform:rotate(360deg)}}
.iui-dialog{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:16px;max-width:min(520px,90vw);font:inherit;font-size:calc(13px + var(--iui-fs-delta, 0px))}
.iui-dialog::backdrop{background:rgba(0,0,0,.45)}
.iui-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.iui-quiz-option{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;cursor:pointer;background:var(--dsw-alias-bg-base)}
.iui-quiz-option[data-state='right']{border-color:var(--dsw-alias-state-success-primary)}
.iui-quiz-option[data-state='wrong']{border-color:var(--dsw-alias-state-error-primary)}
.iui-flashcard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:20px;text-align:center;cursor:pointer;background:var(--dsw-alias-bg-layer-2);min-height:110px;display:flex;align-items:center;justify-content:center}
.iui-flashcard:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iui-countdown{display:flex;gap:8px;align-items:baseline;font-variant-numeric:tabular-nums}
.iui-count-cell{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px 10px;text-align:center;min-width:52px}
.iui-count-num{font-size:calc(20px + var(--iui-fs-delta, 0px));font-weight:600}
.iui-count-unit{color:var(--dsw-alias-label-secondary);font-size:calc(11px + var(--iui-fs-delta, 0px))}
.iui-bind-error{color:var(--dsw-alias-state-error-primary);font-size:calc(11px + var(--iui-fs-delta, 0px));font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.iui-node-error{border:1px dashed var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 10px;color:var(--dsw-alias-state-error-primary);font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-stream-bar{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:calc(11.5px + var(--iui-fs-delta, 0px))}
.iui-playground{display:flex;flex-direction:column;gap:10px}
.iui-editor{width:100%;box-sizing:border-box;min-height:160px;font:calc(11.5px + var(--iui-fs-delta, 0px))/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);resize:vertical}
.iui-editor:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.iui-validate{border-radius:8px;padding:8px 10px;font-size:calc(12px + var(--iui-fs-delta, 0px));background:var(--dsw-alias-bg-layer-2)}
.iui-validate[data-ok='false']{border-left:3px solid var(--dsw-alias-state-error-primary)}
.iui-validate[data-ok='true']{border-left:3px solid var(--dsw-alias-state-success-primary)}
.iui-markdown{display:flex;flex-direction:column;gap:8px}
.iui-markdown p{margin:0}
.iui-markdown pre{margin:0}
.iui-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.iui-timeline li{display:grid;grid-template-columns:14px 1fr;gap:10px}
.iui-timeline-dot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-brand-primary);margin-top:6px}
.iui-sources{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:calc(12px + var(--iui-fs-delta, 0px))}
.iui-math{font-family:Georgia,'Times New Roman',serif;font-size:calc(15px + var(--iui-fs-delta, 0px))}
.iui-math sup,.iui-math sub{font-size:.72em}
.iui-math-frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 3px}
.iui-math-frac>span:first-child{border-bottom:1px solid currentColor;padding:0 4px}
.iui-math-sqrt{border-top:1px solid currentColor;padding:0 3px;margin-left:2px}
`

    /**
     * Cap on table rows drawn before the body scrolls.
     *
     * Columns are unbounded — a wide table simply scrolls sideways. Rows are not:
     * a 50-row table would otherwise push the conversation off-screen, so the
     * body is capped at this many rows and scrolls inside the card instead. The
     * cap is a count, and its height comes from the `--iui-row-h` variable, so it
     * stays "15 rows" at whatever type size the user picked.
     */
    const MAX_TABLE_ROWS = 15

    /**
     * Wrap a table so it scrolls instead of overflowing the card.
     * @param props - the row count, an accessible name, and the table.
     * @returns the scrolling container.
     */
    function TableScroll({ rows, label, children }) {
      const capped = rows > MAX_TABLE_ROWS
      return h('div', {
        className: capped ? 'iui-scroll iui-scroll-y' : 'iui-scroll',
        // A scrollable region that a keyboard cannot reach is a dead end, so the
        // container takes focus and names itself once it actually scrolls.
        tabIndex: capped ? 0 : undefined,
        role: capped ? 'region' : undefined,
        'aria-label': capped ? label : undefined,
      }, children)
    }

    /**
     * Resolve a theme token to a concrete color at call time.
     * @param name - the CSS custom property name.
     * @param fallback - used when the token is absent or the DOM is unavailable.
     * @returns a CSS color string.
     */
    function token(name, fallback) {
      if (typeof document === 'undefined') return fallback
      const value = getComputedStyle(document.documentElement).getPropertyValue(name)
      return value.trim() === '' ? fallback : value.trim()
    }

    /**
     * Read the user's content font size.
     *
     * The property lives on `document.body`, which is where the theme presenter
     * writes it, so this reads the body rather than the root element `token()`
     * uses. A missing or unparseable value falls back to the 14px default.
     * @returns the size in px.
     */
    function fontSize() {
      if (typeof document === 'undefined' || document.body === null) return FONT_BASE
      const raw = getComputedStyle(document.body).getPropertyValue(FONT_VAR)
      const px = Number.parseFloat(raw)
      return Number.isFinite(px) ? px : FONT_BASE
    }

    /**
     * Shift a size authored against the 14px default to the user's setting.
     *
     * This adds the offset rather than scaling by a ratio, matching what the
     * stylesheet does. Multiplying would shrink 11px axis labels to 8px at the
     * 10px setting — unreadable, which is the opposite of what someone reaching
     * for a font-size control wants. Adding the offset keeps every step's
     * legibility while still tracking the setting one for one.
     * @param size - the px size at the default.
     * @param size16 - the setting in px.
     * @returns the adjusted px size.
     */
    function scaleSize(size, size16) {
      return Math.round((size + (size16 - FONT_BASE)) * 10) / 10
    }

    /**
     * Shift a *text* size, keeping the smallest steps legible.
     *
     * The setting bottoms out at 10px, which would drag an 11px axis label down
     * to 7px — smaller than DSH's own minimum text. Clamping only the text keeps
     * the smallest steps readable while everything still follows the setting.
     * Layout metrics use `scaleSize` instead: they may shrink, because a row that
     * refuses to get smaller would break the row cap.
     * @param size - the px size at the default.
     * @param size16 - the setting in px.
     * @returns the adjusted px size, never below FONT_FLOOR.
     */
    function scaleText(size, size16) {
      return Math.max(FONT_FLOOR, scaleSize(size, size16))
    }

    /**
     * Set the per-card font variables.
     *
     * The card passes its own scale down as CSS variables rather than reading the
     * setting in every rule, so a font-size change repaints from one write and
     * every `calc()` in the stylesheet follows with it.
     *
     * A table row's height is published as its three real parts — line box,
     * vertical padding, border — rather than as one number, because the cap has
     * to survive the box model: an explicit `height` on a cell is only a minimum
     * in table layout, so a row would otherwise come out taller than declared and
     * the cap would silently show fewer than `MAX_TABLE_ROWS` rows.
     * @param size16 - the setting in px.
     * @returns the inline style for the card root.
     */
    function fontStyle(size16) {
      // 20px line box and 4px padding each side at the 14px default.
      const line = scaleSize(20, size16)
      const pad = scaleSize(4, size16)
      return {
        [FONT_VAR]: `${size16}px`,
        '--iui-fs-delta': `${size16 - FONT_BASE}px`,
        '--iui-row-line': `${line}px`,
        '--iui-row-pad': `${pad}px`,
        // The shared border is folded into one of the two rows it separates, so
        // half of it is charged per row; without the extra pixel the cap would
        // show 14 rows and a sliver instead of 15.
        '--iui-row-h': `${Math.round((line + pad * 2 + 1.5) * 10) / 10}px`,
        '--iui-table-rows': String(MAX_TABLE_ROWS),
      }
    }

    /**
     * Snapshot the theme colors a card needs, so a scheme switch re-renders.
     *
     * The content font size rides along because charts and diagrams take real px
     * numbers rather than CSS: a snapshot whose `fontSize` changed is what tells
     * those components to rebuild their options.
     */
    function readColors() {
      return {
        brand: token('--dsw-alias-brand-primary', '#247bbf'),
        label: token('--dsw-alias-label-primary', '#111'),
        muted: token('--dsw-alias-label-secondary', '#666'),
        layer: token('--dsw-alias-bg-layer-2', '#eee'),
        border: token('--dsw-alias-border-l1', '#ddd'),
        success: token('--dsw-alias-state-success-primary', '#2e7d32'),
        warn: token('--dsw-alias-state-warn-primary', '#b26a00'),
        error: token('--dsw-alias-state-error-primary', '#c62828'),
        idle: token('--dsw-alias-state-idle-primary', '#999'),
        fontSize: fontSize(),
      }
    }

    /**
     * Read the normalized spec from one tool block.
     * @param block - preparing, dispatched, or settled Tool block from the slot.
     * @returns the spec, or null when arguments are unavailable or malformed.
     */
    function readSpec(block) {
      const call = block && 'kind' in block ? block.call : block
      if (!call || typeof call.argsRaw !== 'string' || call.argsRaw === '') return null
      try {
        const parsed = JSON.parse(call.argsRaw)
        const spec = parsed && parsed.spec
        return spec && typeof spec === 'object' && typeof spec.kind === 'string' ? spec : null
      } catch {
        return null
      }
    }

    /**
     * Format a number for display without inventing precision.
     * @param value - the number to format.
     * @returns the display string.
     */
    function fmt(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '')
      if (Number.isInteger(value)) return value.toLocaleString()
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    /**
     * Resolve a semantic tone, or a positional palette step, to a color.
     * @param tone - the semantic name, when the spec set one.
     * @param index - the point's position, for the untoned palette.
     * @param colors - the current theme snapshot.
     * @returns a CSS color string.
     */
    function colorFor(tone, index, colors) {
      if (tone && TONE_TOKEN[tone]) return colors[tone === 'neutral' ? 'idle' : tone] ?? colors.brand
      return colors.brand
    }

    /** The opacity a point's series step uses; toned points are fully opaque. */
    function alphaFor(tone, index) {
      if (tone) return 1
      return PALETTE_ALPHA[index % PALETTE_ALPHA.length]
    }

    function Frame({ spec, children, colors }) {
      return h('div', { className: 'iui-card', style: fontStyle(colors?.fontSize ?? FONT_BASE) },
        spec.title ? h('div', { className: 'iui-title' }, spec.title) : null,
        children,
        spec.caption ? h('div', { className: 'iui-caption' }, spec.caption) : null)
    }

    function Compare({ spec, t }) {
      return h(TableScroll, { rows: spec.rows.length, label: `${t('table')}: ${spec.columns.length} × ${spec.rows.length}` },
        h('table', { className: 'iui-table' },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col' }, ''),
            spec.columns.map((column, index) => h('th', { key: index, scope: 'col' }, column)))),
          h('tbody', null, spec.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
            h('th', { scope: 'row', className: 'iui-rowhead' }, row.label),
            row.cells.map((cell, cellIndex) => h('td', { key: cellIndex }, cell)))))))
    }

    function Stats({ spec, colors }) {
      const stats = Array.isArray(spec.stats) ? spec.stats : []
      return h('div', { className: 'iui-stats' }, stats.map((stat, index) => h('div', {
        key: index,
        className: 'iui-stat',
        style: stat.tone ? { borderLeftColor: colorFor(stat.tone, index, colors) } : undefined,
      },
      h('div', { className: 'iui-stat-value' }, fmt(stat.value)),
      h('div', { className: 'iui-stat-label' }, stat.hint ? `${stat.label} · ${stat.hint}` : stat.label))))
    }

    function Steps({ spec }) {
      return h('ol', { className: 'iui-steps' }, spec.steps.map((step, index) => h('li', { className: 'iui-step', key: index },
        h('div', { className: 'iui-step-n', 'aria-hidden': true }, index + 1),
        h('div', null,
          h('div', null, step.text),
          step.detail ? h('div', { className: 'iui-step-detail' }, step.detail) : null))))
    }

    function Table({ spec, t }) {
      return h(TableScroll, { rows: spec.rows.length, label: `${t('table')}: ${spec.columns.length} × ${spec.rows.length}` },
        h('table', { className: 'iui-table' },
          h('thead', null, h('tr', null, spec.columns.map((column, index) => h('th', { key: index, scope: 'col' }, column)))),
          h('tbody', null, spec.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
            row.map((cell, cellIndex) => h('td', {
              key: cellIndex,
              className: cellIndex === 0 ? 'iui-rowhead' : 'iui-num',
            }, cell)))))))
    }

    function Note({ spec }) {
      const tone = spec.tone && spec.tone !== 'info' ? ` iui-note-${spec.tone}` : ''
      return h('div', { className: `iui-note${tone}` }, h('div', null, spec.text))
    }

    /**
     * A ratio as a ring plus its figure — the "how many of these passed" shape.
     * Drawn as inline SVG rather than through ECharts: one arc does not justify
     * waiting for the chart chunk.
     * @param props - the spec and the current theme colors.
     * @returns the progress card body.
     */
    function Progress({ spec, colors, t }) {
      const pct = Math.max(0, Math.min(spec.value / spec.max, 1))
      const size = 96
      const stroke = 9
      const radius = (size - stroke) / 2
      const circumference = 2 * Math.PI * radius
      const color = colorFor(spec.tone, 0, colors)
      const shown = Math.round(pct * 1000) / 10

      return h('div', { className: 'iui-progress' },
        h('svg', {
          className: 'iui-ring',
          width: size, height: size, viewBox: `0 0 ${size} ${size}`,
          role: 'img',
          'aria-label': `${fmt(spec.value)} ${t('of')} ${fmt(spec.max)}${spec.unit ?? ''} (${shown}%)`,
        },
        h('circle', {
          className: 'iui-ring-track', cx: size / 2, cy: size / 2, r: radius,
          fill: 'none', strokeWidth: stroke,
        }),
        h('circle', {
          className: 'iui-ring-value', cx: size / 2, cy: size / 2, r: radius,
          fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round',
          strokeDasharray: circumference,
          strokeDashoffset: circumference * (1 - pct),
          transform: `rotate(-90 ${size / 2} ${size / 2})`,
        }),
        h('text', { className: 'iui-ring-num', x: size / 2, y: size / 2 + 2, textAnchor: 'middle' }, `${shown}%`),
        h('text', { className: 'iui-ring-unit', x: size / 2, y: size / 2 + 18, textAnchor: 'middle' }, spec.unit ?? '')),
        h('div', { className: 'iui-progress-body' },
          h('div', { className: 'iui-progress-label' }, spec.label ?? `${fmt(spec.value)} ${t('of')} ${fmt(spec.max)}`),
          h('div', { className: 'iui-progress-sub' }, `${fmt(spec.value)} / ${fmt(spec.max)}${spec.unit ?? ''}`)))
    }

    /**
     * Mount an ECharts instance, loading the library chunk on first use.
     *
     * The chunk is a sibling file served from the plugin route, so a plain-JS
     * plugin ships a real charting library without a bundler. If it fails to
     * load, the caller's fallback renders instead of an empty box.
     * @param props - the ECharts option, height, and the fallback element.
     * @returns the chart host, or the fallback.
     */
    function EChart({ option, height, fallback, t }) {
      const host = useRef(null)
      const chart = useRef(null)
      const [lib, setLib] = useState(null)
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        let alive = true
        require.async('./client.echarts.js')
          .then((mod) => { if (alive) setLib(mod) })
          .catch(() => { if (alive) setFailed(true) })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (lib === null || host.current === null) return undefined
        const instance = lib.init(host.current, null, { renderer: 'svg' })
        chart.current = instance
        const observer = typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => instance.resize())
        observer?.observe(host.current)
        return () => {
          observer?.disconnect()
          instance.dispose()
          chart.current = null
        }
      }, [lib])

      useEffect(() => {
        if (chart.current === null || option === null) return
        chart.current.setOption(option, true)
        chart.current.resize()
      }, [option, lib])

      if (failed) return fallback
      return h('div', null,
        h('div', { ref: host, className: 'iui-canvas', style: { height } }),
        lib === null && fallback !== null ? h('div', { className: 'iui-empty' }, t('rendering')) : null)
    }

    /**
     * Build the ECharts option for one chart spec.
     * @param spec - the normalized chart spec.
     * @param colors - the current theme snapshot.
     * @param t - the locale lookup.
     * @returns an ECharts option object.
     */
    function chartOption(spec, colors, t) {
      const labels = spec.series.map((point) => point.label)
      const values = spec.series.map((point) => point.value)
      const suffix = spec.unit ?? ''
      // ECharts takes px numbers, not CSS, so the setting is scaled here once.
      const size = colors.fontSize ?? FONT_BASE
      const axisText = { color: colors.muted, fontSize: scaleText(11, size) }
      const splitLine = { lineStyle: { color: colors.border } }
      const toned = spec.series.some((point) => point.tone)

      if (spec.variant === 'pie' || spec.variant === 'donut') {
        return {
          animationDuration: 260,
          textStyle: { color: colors.label, fontSize: scaleText(12, size) },
          tooltip: { trigger: 'item', valueFormatter: (value) => `${fmt(value)}${suffix}` },
          legend: { bottom: 0, textStyle: axisText, icon: 'circle', itemWidth: 8, itemHeight: 8 },
          series: [{
            type: 'pie',
            radius: spec.variant === 'donut' ? ['46%', '70%'] : ['0%', '70%'],
            center: ['50%', '46%'],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: colors.layer, borderWidth: 2 },
            label: { color: colors.muted, fontSize: scaleText(11, size), formatter: '{b} {d}%' },
            labelLine: { lineStyle: { color: colors.border } },
            data: spec.series.map((point, index) => ({
              name: point.label,
              value: point.value,
              itemStyle: {
                color: colorFor(point.tone, index, colors),
                opacity: alphaFor(point.tone, index),
              },
            })),
          }],
        }
      }

      const isLine = spec.variant === 'line' || spec.variant === 'area'
      const isScatter = spec.variant === 'scatter'
      return {
        animationDuration: 260,
        grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
        textStyle: { color: colors.label, fontSize: scaleText(12, size) },
        tooltip: {
          trigger: isScatter ? 'item' : 'axis',
          valueFormatter: (value) => `${fmt(value)}${suffix}`,
        },
        xAxis: isScatter ? {
          type: 'value',
          axisLabel: axisText,
          axisLine: { lineStyle: { color: colors.border } },
          splitLine,
        } : {
          type: 'category',
          data: labels,
          axisLabel: { ...axisText, interval: 0, hideOverlap: true },
          axisLine: { lineStyle: { color: colors.border } },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { ...axisText, formatter: (value) => `${fmt(value)}${suffix}` },
          splitLine,
        },
        series: [{
          type: isScatter ? 'scatter' : isLine ? 'line' : 'bar',
          data: isScatter
            ? spec.series.map((point, index) => ({
              value: [Number.isFinite(point.x) ? point.x : index, point.value],
              name: point.label,
              itemStyle: {
                color: colorFor(point.tone, index, colors),
                opacity: alphaFor(point.tone, index),
              },
            }))
            : spec.series.map((point, index) => ({
              value: point.value,
              itemStyle: {
                color: colorFor(point.tone, index, colors),
                opacity: alphaFor(point.tone, index),
                borderRadius: isLine ? 0 : [3, 3, 0, 0],
              },
            })),
          smooth: isLine,
          symbolSize: isScatter ? 9 : 6,
          lineStyle: { width: 2, color: colors.brand },
          areaStyle: spec.variant === 'area' && !toned ? { color: colors.brand, opacity: 0.12 } : undefined,
          barMaxWidth: 48,
        }],
      }
    }

    /** A plain bar fallback, so a chart still reads when the chunk cannot load. */
    function PlainBars({ spec, colors }) {
      const peak = Math.max(...spec.series.map((point) => Math.abs(point.value)), 0) || 1
      return h('div', { className: 'iui-chart' }, spec.series.map((point, index) => {
        const text = `${fmt(point.value)}${spec.unit ?? ''}`
        return h('div', { className: 'iui-bar-row', key: index },
          h('div', { className: 'iui-bar-label', title: point.label }, point.label),
          h('div', { className: 'iui-bar-track', role: 'img', 'aria-label': `${point.label}: ${text}` },
            h('div', {
              className: 'iui-bar-fill',
              style: {
                width: `${Math.max((Math.abs(point.value) / peak) * 100, 1)}%`,
                background: colorFor(point.tone, index, colors),
                opacity: alphaFor(point.tone, index),
              },
            })),
          h('div', { className: 'iui-bar-value' }, text))
      }))
    }

    function Chart({ spec, colors, t }) {
      const option = useMemo(() => chartOption(spec, colors, t), [spec, colors, t])
      // The canvas needs room for the bigger type, but it should not collapse at
      // the small end, so it grows by the offset while keeping its own height as
      // a floor.
      const base = spec.variant === 'pie' || spec.variant === 'donut' ? 240 : 220
      const height = Math.max(base, base + (colors.fontSize ?? FONT_BASE) - FONT_BASE)
      return h(EChart, {
        option,
        height,
        t,
        fallback: h(PlainBars, { spec, colors }),
      })
    }

    /**
     * Render Mermaid source to SVG.
     *
     * Mermaid owns the diagram family: real orthogonal routing and the UML
     * shapes (class, sequence, state, ER, mind map, Gantt), which a charting
     * library's relationship-graph mode does not. Its chunk is a sibling file
     * served from the plugin route, loaded on first use.
     *
     * Mermaid needs a document-attached container and throws on invalid source,
     * so both are handled here: a bad diagram degrades to its own message
     * instead of blanking the slot entry.
     *
     * @param props - the diagram source, the theme snapshot, and the locale lookup.
     * @returns the rendered diagram, a loading note, or the failure message.
     */
    function Mermaid({ source, colors, t }) {
      const [svg, setSvg] = useState(null)
      const [error, setError] = useState(null)
      const id = useRef(`iui-mmd-${Math.random().toString(36).slice(2, 10)}`)

      useEffect(() => {
        let alive = true
        setError(null)
        require.async('./client.mermaid.js')
          .then(async (mermaid) => {
            if (!alive) return
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: 'strict',
              theme: 'base',
              fontFamily: 'inherit',
              themeVariables: {
                fontFamily: 'inherit',
                // Mermaid accepts a CSS length, so the diagram follows the user's
                // setting directly instead of a number resolved at render time.
                fontSize: `calc(13px + ${(colors.fontSize ?? FONT_BASE) - FONT_BASE}px)`,
                background: 'transparent',
                primaryColor: colors.layer,
                primaryTextColor: colors.label,
                primaryBorderColor: colors.border,
                lineColor: colors.muted,
                textColor: colors.label,
                // The tone classes the Host compiles resolve to these.
                ...Object.fromEntries(Object.entries(TONE_TOKEN).map(([tone]) => [`iuiTone${tone}`, ''])),
              },
            })
            try {
              const out = await mermaid.render(id.current, source)
              if (alive) setSvg(out.svg)
            } catch (renderError) {
              if (alive) setError(String((renderError && renderError.message) || renderError))
            }
          })
          .catch(() => { if (alive) setError(t('chartFailed')) })
        return () => { alive = false }
      }, [source, colors, t])

      if (error !== null) {
        return h('div', null,
          h('div', { className: 'iui-empty' }, t('chartFailed')),
          h('pre', { className: 'iui-mmd-error' }, error))
      }
      if (svg === null) return h('div', { className: 'iui-empty' }, t('rendering'))
      // The markup is Mermaid's own output, not model-authored HTML, and
      // `securityLevel: 'strict'` sanitizes the labels that came from the model.
      return h('div', { className: 'iui-mermaid', dangerouslySetInnerHTML: { __html: svg } })
    }

    function Diagram({ spec, colors, t }) {
      const source = typeof spec.mermaid === 'string' ? spec.mermaid : ''
      if (source === '') {
        return h('div', { className: 'iui-empty' }, t('chartFailed'))
      }
      return h(Mermaid, { source, colors, t })
    }

    /** A labelled numeric input with an optional drag range. */
    function Field({ field, value, onChange, t }) {
      const id = `iui-${field.label.replace(/\W+/g, '-').toLowerCase()}`
      const hasRange = typeof field.min === 'number' && typeof field.max === 'number'
      return h('div', { className: 'iui-field' },
        h('label', { htmlFor: id }, field.label),
        h('input', {
          id,
          className: 'iui-input',
          type: 'number',
          value,
          min: field.min,
          max: field.max,
          step: 'any',
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        hasRange ? h('input', {
          className: 'iui-range',
          type: 'range',
          'aria-label': `${field.label} ${t('slider')}`,
          value: Number.isFinite(value) ? value : field.min,
          min: field.min,
          max: field.max,
          step: (field.max - field.min) / 100,
          onChange: (event) => onChange(Number(event.target.value)),
        }) : null)
    }

    function Calculator({ spec, t }) {
      const initial = useMemo(() => {
        const state = {}
        for (const field of spec.fields ?? []) state[field.label] = field.value
        if (Object.keys(state).length === 0) {
          Object.assign(state, spec.mode === 'tip'
            ? { 'Bill amount': 100, 'Tip %': 15, People: 2 }
            : { 'Bill amount': 100, People: 4, 'Tip %': 0 })
        }
        return state
      }, [spec])

      const [values, setValues] = useState(initial)
      const set = (label) => (next) => setValues((current) => ({ ...current, [label]: next }))

      const pick = (needle) => {
        const key = Object.keys(values).find((name) => name.toLowerCase().includes(needle))
        return key === undefined ? 0 : Number(values[key]) || 0
      }
      const amount = pick('bill') || pick('amount')
      const people = Math.max(Math.floor(pick('people')) || 1, 1)
      const rate = pick('tip')
      const tip = amount * (rate / 100)
      const total = amount + tip
      const each = total / people

      const rows = [
        ...(rate ? [['Tip', tip]] : []),
        ['Total', total],
        [`Per person (${people})`, each],
      ]

      return h('div', null,
        h('div', { className: 'iui-fields' }, Object.entries(values).map(([label, value]) => h(Field, {
          key: label,
          field: { label, value, ...(spec.fields ?? []).find((field) => field.label === label) },
          value,
          onChange: set(label),
          t,
        }))),
        h('div', { className: 'iui-result', role: 'status', 'aria-live': 'polite' },
          rows.map(([label, value], index) => h('div', {
            key: label,
            className: index === rows.length - 1 ? 'iui-result-row iui-total' : 'iui-result-row',
          }, h('span', null, label), h('b', null, fmt(Math.round(value * 100) / 100))))))
    }

    function Unit({ spec, t }) {
      const factors = useMemo(() => {
        const declared = spec.factors
        const out = {}
        spec.units.forEach((unit, index) => {
          out[unit] = declared && typeof declared[unit] === 'number' ? declared[unit] : index + 1
        })
        return out
      }, [spec])

      const [value, setValue] = useState(typeof spec.value === 'number' ? spec.value : 1)
      const [from, setFrom] = useState(spec.from && factors[spec.from] !== undefined ? spec.from : spec.units[0])
      const [to, setTo] = useState(spec.to && factors[spec.to] !== undefined ? spec.to : spec.units[1])
      const converted = (value * factors[from]) / factors[to]

      const select = (selected, onSelect, label) => h('select', {
        className: 'iui-input',
        'aria-label': label,
        value: selected,
        onChange: (event) => onSelect(event.target.value),
      }, spec.units.map((unit) => h('option', { key: unit, value: unit }, unit)))

      return h('div', null,
        h('div', { className: 'iui-fields' },
          h('div', { className: 'iui-field' },
            h('label', { htmlFor: 'iui-unit-value' }, t('amount')),
            h('input', {
              id: 'iui-unit-value',
              className: 'iui-input',
              type: 'number',
              step: 'any',
              value,
              onChange: (event) => setValue(Number(event.target.value)),
            })),
          h('div', { className: 'iui-field' }, h('span', null, t('from')), select(from, setFrom, t('convertFrom'))),
          h('div', { className: 'iui-field' }, h('span', null, t('to')), select(to, setTo, t('convertTo')))),
        h('div', { className: 'iui-result', role: 'status', 'aria-live': 'polite' },
          h('div', { className: 'iui-result-row iui-total' },
            h('span', null, `${fmt(value)} ${from} =`),
            h('b', null, `${fmt(Math.round(converted * 1e6) / 1e6)} ${to}`))))
    }

    /**
     * Load the shared engine chunk once.
     *
     * `engine.cjs` is the single source for the registry, the safe expression
     * language, schema validation, action planning and the stream protocol;
     * `build-engine.mjs` wraps it into this lazy chunk so the Host and the
     * Client cannot drift apart. Everything `app`/`playground` renders goes
     * through it.
     * @returns a promise of the engine module.
     */
    let enginePromise = null
    function loadEngine() {
      if (enginePromise === null) {
        enginePromise = require.async('./client.engine.js').catch((error) => {
          enginePromise = null
          throw error
        })
      }
      return enginePromise
    }

    /** Fields register with their enclosing form so `submit` can validate them. */
    const FormContext = React.createContext(null)

    /** Toast identity, purely client-side feedback for executed actions. */
    let toastSeq = 0

    /**
     * The app runtime: shared state, computed values, and the Action Router's
     * execution half.
     *
     * `engine.planAction` decides *what* may happen (permission checks, URL
     * protocol, service registry); this hook performs the effect and reports
     * success only once the effect really happened — a blocked popup, a denied
     * clipboard write or an unconfigured service all surface as an error toast
     * with the reason, never as a silent success.
     * @param engine - the shared engine module.
     * @param spec - the normalized `app` spec.
     * @param t - the locale lookup.
     * @returns the runtime handles the components consume through `ctx`.
     */
    function useAppRuntime(engine, spec, t) {
      const [state, setState] = useState(() => ({ ...(spec.state ?? {}) }))
      const [toasts, setToasts] = useState([])
      // No external service ships configured; `call` actions report
      // "not connected" until a service is registered here.
      const services = useRef({})

      const toast = useCallback((text, tone = 'info') => {
        toastSeq += 1
        const id = toastSeq
        setToasts((current) => current.concat({ id, text, tone }))
        setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4500)
      }, [])

      const computed = useMemo(
        () => engine.computeAll(spec.compute ?? {}, state),
        [engine, spec.compute, state],
      )
      const scope = useMemo(() => ({ ...state, ...computed }), [state, computed])

      const dispatch = useCallback((action, eventValue) => {
        const plan = engine.planAction(action, { state, computed, eventValue, services: services.current })
        switch (plan.kind) {
          case 'set':
          case 'toggle':
            setState((current) => engine.setPath(current, plan.path, plan.value))
            return true
          case 'copy': {
            const write = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
              ? navigator.clipboard.writeText(plan.text)
              : Promise.reject(new Error('Clipboard API unavailable'))
            write
              .then(() => toast(t('copied'), 'success'))
              .catch((error) => toast(`${t('copyFailed')}: ${String((error && error.message) || error)}`, 'error'))
            return true
          }
          case 'open': {
            // window.open returns null when the popup blocker turns the call
            // down — that is the execution result, and it is what the user sees.
            const opened = typeof window !== 'undefined' && window.open(plan.url, '_blank', 'noopener,noreferrer')
            if (opened) toast(plan.url, 'success')
            else toast(t('openBlocked'), 'error')
            return opened !== null
          }
          case 'submit':
            toast(t('submitted'), 'success')
            return true
          case 'call': {
            toast(`${plan.service}: ${t('loading')}`, 'info')
            Promise.resolve()
              .then(() => plan.run(plan.payload))
              .then(() => toast(`${plan.service}: ${t('submitted')}`, 'success'))
              .catch((error) => toast(`${t('serviceFailed')}: ${String((error && error.message) || error)}`, 'error'))
            return true
          }
          default:
            toast(plan.notConnected ? `${plan.service}: ${t('notConnected')}` : plan.message, 'error')
            return false
        }
      }, [state, computed, toast, t])

      /** Fire one node action for an event, with the component's value. */
      const fire = useCallback((node, event, value) => {
        const action = node && node.on && node.on[event]
        if (action === undefined) return false
        return dispatch(action, value)
      }, [dispatch])

      return { state, setState, computed, scope, dispatch, fire, toasts, toast, services }
    }

    /**
     * Error boundary per node: one broken component degrades to its own error
     * box with the node id, instead of blanking the whole card.
     */
    class NodeBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        // The console is the only place a render crash is recorded; the user
        // sees the localized box instead of a blank slot entry.
        if (typeof console !== 'undefined') console.error('[intelligent-ui]', this.props.id, error)
      }

      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'iui-node-error', role: 'alert' },
            `${this.props.t('nodeError')} · ${this.props.id}: ${String((this.state.error && this.state.error.message) || this.state.error)}`)
        }
        return this.props.children
      }
    }

    /**
     * Recursive renderer: one schema node → one component instance.
     *
     * The boundary wraps the node *including its child resolution*, so a
     * malformed subtree boxes at the node that owns it instead of taking the
     * whole card down.
     */
    function AppNode({ node, ctx }) {
      return h(NodeBoundary, { id: node.id, t: ctx.t }, h(AppNodeInner, { node, ctx }))
    }

    /**
     * Props come from the node's literals overlaid with its `bind` expressions,
     * evaluated against the live scope (state + computed). Children render
     * through `AppNode`, so nesting is the schema's own job.
     */
    function AppNodeInner({ node, ctx }) {
      const props = useMemo(() => ctx.engine.resolveProps(node, ctx.scope), [ctx.engine, ctx.scope, node])
      const Comp = REGISTRY[node.type]
      const bindErrors = Object.keys(props).filter((key) => key.startsWith('__bindError:'))

      if (props.hidden === true) return null
      if (Comp === undefined) {
        return h('div', { className: 'iui-node-error', role: 'alert' }, `${ctx.t('unknownType')}: ${node.type}`)
      }
      const children = (node.children ?? []).map((child) => h(AppNode, { key: child.id, node: child, ctx }))
      const body = h(React.Fragment, null,
        h(Comp, { node, props, ctx, children }),
        ...bindErrors.map((key) => h('div', { key, className: 'iui-bind-error', role: 'alert' },
          `${ctx.t('bindError')} · ${key.slice('__bindError:'.length)}: ${props[key]}`)))
      // `span` only means something inside grid/bento, and a wrapper div is the
      // one place a per-child class can live without touching every component.
      return props.span
        ? h('div', { className: `iui-span-${Math.min(Math.max(Number(props.span) || 1, 1), 3)}` }, body)
        : body
    }

    // ── app components: text ───────────────────────────────────────────

    /** A clickable node action closure. */
    const act = (ctx, node, event, value) => () => ctx.fire(node, event, value)

    /** Map a `size` prop to an inline type scale step. */
    function sizeStyle(size) {
      const px = size === 'lg' ? 15 : size === 'sm' ? 11.5 : 13
      return { fontSize: `calc(${px}px + var(--iui-fs-delta, 0px))` }
    }

    function AppText({ props, ctx }) {
      const style = {
        ...sizeStyle(props.size),
        ...props.align ? { textAlign: props.align } : {},
        ...props.tone ? { color: colorFor(props.tone, 0, ctx.colors) } : {},
        ...props.bold ? { fontWeight: 600 } : {},
        ...props.italic ? { fontStyle: 'italic' } : {},
      }
      return h('div', { style }, String(props.text ?? ''))
    }

    function AppTitle({ props }) {
      const level = Math.min(Math.max(Number(props.level) || 2, 1), 3)
      return h(`h${level + 2}`, {
        style: {
          margin: 0,
          fontWeight: 600,
          fontSize: level === 1 ? 'calc(17px + var(--iui-fs-delta, 0px))'
            : level === 2 ? 'calc(15px + var(--iui-fs-delta, 0px))'
              : 'calc(13.5px + var(--iui-fs-delta, 0px))',
          ...props.align ? { textAlign: props.align } : {},
        },
      }, String(props.text ?? ''))
    }

    function AppCaption({ props }) {
      return h('div', { className: 'iui-caption', style: { marginTop: 0 } }, String(props.text ?? ''))
    }

    function AppLabel({ props }) {
      return h('span', { className: 'iui-help' }, String(props.text ?? ''))
    }

    function AppBold({ props }) {
      return h('b', null, String(props.text ?? ''))
    }

    function AppItalic({ props }) {
      return h('i', null, String(props.text ?? ''))
    }

    function AppBadge({ props, ctx }) {
      const color = props.tone ? colorFor(props.tone, 0, ctx.colors) : ctx.colors.brand
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', borderRadius: 999,
          padding: '2px 10px', fontSize: 'calc(11.5px + var(--iui-fs-delta, 0px))',
          border: `1px solid ${color}`, color,
        },
      }, String(props.text ?? ''))
    }

    function AppLink({ props, ctx, node }) {
      const href = typeof props.href === 'string' && /^https?:\/\//i.test(props.href) ? props.href : null
      return h('a', {
        href: href ?? undefined,
        target: props.external === true ? '_blank' : undefined,
        rel: props.external === true ? 'noopener noreferrer' : undefined,
        onClick: node.on && node.on.click ? act(ctx, node, 'click', props.href) : undefined,
        style: { color: ctx.colors.brand },
      }, String(props.text ?? props.href ?? ''))
    }

    function AppQuote({ props }) {
      return h('blockquote', {
        style: {
          margin: 0, borderLeft: '3px solid var(--dsw-alias-border-l2)',
          paddingLeft: 12, color: 'var(--dsw-alias-label-secondary)',
        },
      },
      h('div', null, String(props.text ?? '')),
      props.cite ? h('div', { className: 'iui-help', style: { marginTop: 4 } }, `— ${String(props.cite)}`) : null)
    }

    /**
     * Markdown, the safe subset: headings, lists, quotes, fenced code, and
     * inline bold/italic/code/links. Rendered as React elements — the source is
     * never turned into HTML, so a model cannot inject markup.
     */
    function AppMarkdown({ props, ctx }) {
      const blocks = useMemo(() => parseMarkdown(String(props.text ?? '')), [props.text])
      return h('div', { className: 'iui-markdown' }, blocks.map((block, index) => {
        if (block.type === 'heading') return h(AppTitle, { key: index, props: { text: block.text, level: block.level } })
        if (block.type === 'code') return h(AppCode, { key: index, props: { text: block.text, language: block.language } })
        if (block.type === 'quote') return h(AppQuote, { key: index, props: { text: block.text } })
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return h(Tag, { key: index, style: { margin: 0, paddingLeft: 20 } },
            block.items.map((item, i) => h('li', { key: i }, h(Inline, { text: item, ctx }))))
        }
        return h('p', { key: index }, h(Inline, { text: block.text, ctx }))
      }))
    }

    /** Split markdown into blocks: the unit a renderer rule applies to. */
    function parseMarkdown(text) {
      const blocks = []
      const lines = text.split('\n')
      let list = null
      let fence = null
      for (const raw of lines) {
        const line = raw.trimEnd()
        if (line.startsWith('```')) {
          if (fence === null) fence = { type: 'code', language: line.slice(3).trim(), text: '' }
          else { blocks.push(fence); fence = null }
          continue
        }
        if (fence !== null) {
          fence.text = fence.text === '' ? raw : `${fence.text}\n${raw}`
          continue
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
        if (bullet || numbered) {
          const ordered = Boolean(numbered)
          if (list === null || list.ordered !== ordered) {
            list = { type: 'list', ordered, items: [] }
            blocks.push(list)
          }
          list.items.push((bullet ?? numbered)[1])
          continue
        }
        list = null
        if (line.startsWith('### ')) blocks.push({ type: 'heading', level: 3, text: line.slice(4) })
        else if (line.startsWith('## ')) blocks.push({ type: 'heading', level: 2, text: line.slice(3) })
        else if (line.startsWith('# ')) blocks.push({ type: 'heading', level: 1, text: line.slice(2) })
        else if (line.startsWith('> ')) blocks.push({ type: 'quote', text: line.slice(2) })
        else if (line.trim() !== '') blocks.push({ type: 'paragraph', text: line })
      }
      if (fence !== null) blocks.push(fence)
      return blocks
    }

    /** Inline markdown: bold, italic, code, links — as elements, never HTML. */
    function Inline({ text, ctx }) {
      const parts = useMemo(() => (
        String(text ?? '').split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/)
          .filter((part) => part !== '' && part !== undefined)
      ), [text])
      return h(React.Fragment, null, parts.map((part, index) => {
        if (typeof part !== 'string') return part
        if (part.startsWith('**') && part.endsWith('**')) return h('b', { key: index }, part.slice(2, -2))
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return h('i', { key: index }, part.slice(1, -1))
        if (part.startsWith('`') && part.endsWith('`')) {
          return h('code', {
            key: index,
            style: {
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 4, padding: '1px 5px',
              fontSize: 'calc(12px + var(--iui-fs-delta, 0px))',
            },
          }, part.slice(1, -1))
        }
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
        if (link) {
          return h('a', { key: index, href: link[2], target: '_blank', rel: 'noopener noreferrer', style: { color: ctx.colors.brand } }, link[1])
        }
        return h(React.Fragment, { key: index }, part)
      }))
    }

    function AppCode({ props, ctx }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        props.language ? h('div', { className: 'iui-help' }, String(props.language)) : null,
        h('pre', {
          style: {
            margin: 0, borderRadius: 8, padding: '10px 12px', overflowX: 'auto',
            background: 'var(--dsw-alias-bg-layer-2)',
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 'calc(12px + var(--iui-fs-delta, 0px))',
            whiteSpace: props.wrap === true ? 'pre-wrap' : 'pre',
          },
        }, h('code', null, String(props.text ?? ''))),
        h('div', null, h('button', {
          type: 'button', className: 'iui-btn iui-btn-ghost',
          onClick: () => {
            const text = String(props.text ?? '')
            const write = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
              ? navigator.clipboard.writeText(text)
              : Promise.reject(new Error('Clipboard API unavailable'))
            write.then(() => ctx.toast(ctx.t('copied'), 'success'))
              .catch((error) => ctx.toast(`${ctx.t('copyFailed')}: ${String((error && error.message) || error)}`, 'error'))
          },
        }, ctx.t('copy'))))
    }

    /**
     * Math, a small formula subset: `x^2`, `x_i`, `\frac{a}{b}`, `\sqrt{x}`.
     *
     * ponytail: KaTeX was the alternative and is not used — its renderer needs
     * 20+ woff2 font files, and the plugin route only serves `client.*.js`
     * chunks, so the fonts cannot be delivered and formulas would render with
     * fallback glyphs. Ceiling: the four notation forms above; upgrade path:
     * serve KaTeX with self-hosted fonts from a real bundle when the plugin
     * gains an asset route.
     */
    function AppMath({ props }) {
      const formula = String(props.text ?? '')
      return h('div', {
        className: 'iui-math',
        role: 'math',
        'aria-label': formula,
        style: props.display === true ? { textAlign: 'center', fontSize: 'calc(17px + var(--iui-fs-delta, 0px))' } : undefined,
      }, renderFormula(formula))
    }

    /** Parse the formula subset into nested spans. */
    function renderFormula(source) {
      const out = []
      let i = 0
      let buffer = ''
      const flush = () => {
        if (buffer !== '') { out.push(buffer); buffer = '' }
      }
      while (i < source.length) {
        const rest = source.slice(i)
        const frac = /^\\frac\{([^{}]*)\}\{([^{}]*)\}/.exec(rest)
        if (frac) {
          flush()
          out.push(h('span', { className: 'iui-math-frac', key: out.length },
            h('span', null, renderFormula(frac[1])),
            h('span', null, renderFormula(frac[2]))))
          i += frac[0].length
          continue
        }
        const sqrt = /^\\sqrt\{([^{}]*)\}/.exec(rest)
        if (sqrt) {
          flush()
          out.push(h('span', { key: out.length }, '√',
            h('span', { className: 'iui-math-sqrt' }, renderFormula(sqrt[1]))))
          i += sqrt[0].length
          continue
        }
        const script = /^([_^])(?:\{([^{}]*)\}|(\S))/.exec(rest)
        if (script) {
          flush()
          const Tag = script[1] === '^' ? 'sup' : 'sub'
          out.push(h(Tag, { key: out.length }, renderFormula(script[2] ?? script[3])))
          i += script[0].length
          continue
        }
        buffer += source[i]
        i += 1
      }
      flush()
      return out
    }

    function AppList({ props }) {
      const items = Array.isArray(props.items) ? props.items : []
      const Tag = props.ordered === true ? 'ol' : 'ul'
      return h(Tag, { style: { margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 } },
        items.map((item, index) => {
          const text = typeof item === 'object' && item !== null ? String(item.text ?? '') : String(item ?? '')
          const detail = typeof item === 'object' && item !== null ? item.detail : undefined
          return h('li', { key: index },
            text,
            detail ? h('div', { className: 'iui-help' }, String(detail)) : null)
        }))
    }

    function AppTimeline({ props }) {
      const items = Array.isArray(props.items) ? props.items : []
      return h('ol', { className: 'iui-timeline' }, items.map((item, index) => {
        const entry = typeof item === 'object' && item !== null ? item : { text: String(item ?? '') }
        return h('li', { key: index },
          h('div', { className: 'iui-timeline-dot', 'aria-hidden': true }),
          h('div', null,
            entry.time ? h('div', { className: 'iui-help' }, String(entry.time)) : null,
            entry.title ? h('div', { style: { fontWeight: 600 } }, String(entry.title)) : null,
            entry.text ? h('div', null, String(entry.text)) : null))
      }))
    }

    function AppSources({ props }) {
      const items = Array.isArray(props.items) ? props.items : []
      return h('ul', { className: 'iui-sources' }, items.map((item, index) => {
        const entry = typeof item === 'object' && item !== null ? item : { title: String(item ?? '') }
        const href = typeof entry.href === 'string' && /^https?:\/\//i.test(entry.href) ? entry.href : null
        return h('li', { key: index },
          href
            ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--dsw-alias-brand-primary)' } }, String(entry.title ?? href))
            : h('span', null, String(entry.title ?? '')),
          entry.detail ? h('span', { className: 'iui-help' }, ` · ${String(entry.detail)}`) : null)
      }))
    }

    // ── app components: layout ─────────────────────────────────────────

    function AppBox({ props, children }) {
      return h('div', {
        className: 'iui-row',
        style: {
          padding: props.padding ?? 0,
          gap: props.gap ?? 10,
          flexDirection: props.wrap === false ? 'row' : undefined,
          alignItems: props.align,
          justifyContent: props.justify,
          flexWrap: props.wrap === false ? 'nowrap' : 'wrap',
          ...props.tone ? { borderLeft: `3px solid var(--iui-tone-${props.tone})`, paddingLeft: 10 } : {},
        },
      }, children)
    }

    function AppRow({ props, children }) {
      return h('div', {
        className: 'iui-row',
        style: {
          gap: props.gap ?? 10,
          alignItems: props.align,
          justifyContent: props.justify,
          flexWrap: props.wrap === false ? 'nowrap' : 'wrap',
        },
      }, children)
    }

    function AppColumn({ props, children }) {
      return h('div', {
        className: 'iui-col',
        style: { gap: props.gap ?? 10, alignItems: props.align },
      }, children)
    }

    function AppCard({ props, children }) {
      return h('div', { className: `iui-card2${props.accent === true ? ' iui-card2-accent' : ''}` },
        props.title ? h('div', { className: 'iui-card2-title' }, String(props.title)) : null,
        props.subtitle ? h('div', { className: 'iui-card2-sub' }, String(props.subtitle)) : null,
        children,
        props.footer ? h('div', { className: 'iui-card2-sub' }, String(props.footer)) : null)
    }

    function AppGrid({ props, children }) {
      return h('div', {
        className: 'iui-grid',
        style: {
          gridTemplateColumns: props.columns
            ? `repeat(${Math.min(Math.max(Number(props.columns) || 2, 1), 6)}, minmax(0, 1fr))`
            : `repeat(auto-fit, minmax(${props.minWidth ?? 180}px, 1fr))`,
          gap: props.gap ?? 10,
        },
      }, children)
    }

    function AppBento({ props, children }) {
      return h('div', { className: 'iui-bento', style: { gap: props.gap ?? 10 } }, children)
    }

    function AppFlow({ props, children }) {
      return h('div', { className: 'iui-flow', style: { gap: props.gap ?? 10 } }, children)
    }

    function AppDivider({ props }) {
      return props.label
        ? h('div', { className: 'iui-divider-label' }, String(props.label))
        : h('div', { className: 'iui-divider', role: 'separator' })
    }

    function AppSpacer({ props }) {
      return h('div', { style: { height: props.size ?? 12 }, 'aria-hidden': true })
    }

    function AppResponsive({ props, children }) {
      return h('div', {
        className: 'iui-col',
        style: {
          gap: props.gap ?? 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
        },
      }, children)
    }

    /**
     * Read a container child's label — literal or bound — since `tabs` and
     * `accordion` label their panels from the child node's own `label` prop.
     */
    function childLabel(child, ctx, fallback) {
      const node = child && child.props && child.props.node
      if (!node) return String(fallback)
      const resolved = ctx.engine.resolveProps(node, ctx.scope)
      return String(resolved.label ?? fallback)
    }

    function AppTabs({ props, children, ctx }) {
      const labels = children.map((child, index) => childLabel(child, ctx, index + 1))
      const [active, setActive] = useState(() => Math.min(Math.max(Number(props.active) || 0, 0), Math.max(children.length - 1, 0)))
      const onKeyDown = (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const step = event.key === 'ArrowRight' ? 1 : -1
        setActive((current) => (current + step + children.length) % children.length)
      }
      return h('div', { className: 'iui-tabs' },
        h('div', { className: 'iui-tablist', role: 'tablist', onKeyDown }, labels.map((label, index) => h('button', {
          key: index,
          type: 'button',
          role: 'tab',
          id: `tab-${index}`,
          'aria-selected': index === active,
          'aria-controls': `tabpanel-${index}`,
          tabIndex: index === active ? 0 : -1,
          onClick: () => setActive(index),
        }, label))),
        h('div', {
          role: 'tabpanel',
          id: `tabpanel-${active}`,
          'aria-labelledby': `tab-${active}`,
          tabIndex: 0,
        }, children[active] ?? null))
    }

    function AppTab({ children }) {
      return h('div', { className: 'iui-col' }, children)
    }

    function AppAccordion({ props, children, ctx }) {
      const [open, setOpen] = useState(() => children.map((child, index) => {
        const node = child && child.props && child.props.node
        return Boolean(node && node.props && node.props.open === true) || index === 0
      }))
      const toggle = (index) => setOpen((current) => current.map((value, i) => {
        if (i !== index) return props.multiple === true ? value : false
        return !value
      }))
      return h('div', { className: 'iui-acc' }, children.map((child, index) => {
        const label = childLabel(child, ctx, index + 1)
        return h('div', { className: 'iui-acc-item', key: index },
          h('button', {
            type: 'button',
            className: 'iui-acc-head',
            'aria-expanded': Boolean(open[index]),
            onClick: () => toggle(index),
          },
          h('span', null, label),
          h('span', { 'aria-hidden': true }, open[index] ? '−' : '+')),
          open[index] ? h('div', { className: 'iui-acc-body' }, child) : null)
      }))
    }

    function AppAccordionItem({ children }) {
      return h('div', { className: 'iui-col' }, children)
    }

    function AppPopover({ props, children, ctx }) {
      const [open, setOpen] = useState(false)
      const ref = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [open])
      return h('div', { className: 'iui-pop', ref },
        h('button', {
          type: 'button',
          className: 'iui-btn',
          'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
        }, String(props.trigger ?? props.title ?? ctx.t('apply'))),
        open ? h('div', { className: 'iui-pop-panel', role: 'dialog', 'aria-label': props.title ? String(props.title) : undefined },
          props.title ? h('div', { style: { fontWeight: 600, marginBottom: 6 } }, String(props.title)) : null,
          children) : null)
    }

    function AppTooltip({ props, children }) {
      const [open, setOpen] = useState(false)
      return h('span', {
        className: 'iui-tip-wrap',
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      },
      children,
      open ? h('span', { className: 'iui-tip', role: 'tooltip' }, String(props.hint ?? '')) : null)
    }

    function AppCarousel({ props, children, ctx }) {
      const [index, setIndex] = useState(0)
      const count = children.length
      const go = (step) => setIndex((current) => (current + step + count) % count)
      return h('div', { className: 'iui-carousel' },
        h('div', {
          className: 'iui-carousel-frame',
          style: { height: props.height ?? 220 },
          role: 'group',
          'aria-roledescription': 'carousel',
          'aria-label': ctx.t('slide'),
        }, count === 0 ? h('div', { className: 'iui-empty' }, ctx.t('empty')) : children[index]),
        count > 1 ? h('div', { className: 'iui-carousel-nav' },
          h('button', { type: 'button', className: 'iui-icon-btn', 'aria-label': ctx.t('prev'), onClick: () => go(-1) }, '‹'),
          h('div', { className: 'iui-dots' }, children.map((child, i) => h('button', {
            key: i,
            type: 'button',
            className: 'iui-dot',
            'aria-label': `${ctx.t('slide')} ${i + 1}`,
            'aria-current': i === index,
            onClick: () => setIndex(i),
          }))),
          h('button', { type: 'button', className: 'iui-icon-btn', 'aria-label': ctx.t('next'), onClick: () => go(1) }, '›')) : null)
    }

    // ── app components: controls ───────────────────────────────────────

    /**
     * Register a field with the enclosing `form`, so `submit` can validate the
     * required ones and hand their values to the action.
     */
    function useRegisterField(ctx, node, props, value) {
      const form = useContext(FormContext)
      const name = String(props.name ?? props.label ?? node.id)
      const required = props.required === true
      useEffect(() => {
        if (!form) return undefined
        return form.register({ id: node.id, name, value, required })
      }, [form, node.id, name, value, required])
    }

    /** Options may be plain strings or `{label, value}` pairs. */
    function optionList(options) {
      return (Array.isArray(options) ? options : []).map((option) => (
        typeof option === 'object' && option !== null
          ? { label: String(option.label ?? option.value ?? ''), value: option.value ?? option.label }
          : { label: String(option ?? ''), value: option }
      ))
    }

    /** Is this field driven by a binding, or does it keep its own echo state? */
    function useEcho(node, props, fallback) {
      const bound = Boolean(node.bind && Object.prototype.hasOwnProperty.call(node.bind, 'value'))
      const [echo, setEcho] = useState(() => (props.value ?? fallback))
      useEffect(() => {
        if (bound) setEcho(props.value ?? fallback)
      }, [bound, props.value, fallback])
      return [bound ? (props.value ?? fallback) : echo, setEcho, bound]
    }

    function AppButton({ props, ctx, node }) {
      const variant = props.variant === 'primary' ? ' iui-btn-primary'
        : props.variant === 'ghost' ? ' iui-btn-ghost' : ''
      return h('button', {
        type: 'button',
        className: `iui-btn${variant}${props.fullWidth === true ? ' iui-btn-full' : ''}`,
        disabled: props.disabled === true,
        onClick: () => ctx.fire(node, 'click'),
      },
      props.icon && ICON_NAMES.has(props.icon) ? h(Icon, { name: props.icon }) : null,
      String(props.label ?? ''))
    }

    /** The tiny built-in glyph set: no icon dependency, no remote font. */
    const ICON_NAMES = new Set(['check', 'close', 'plus', 'minus', 'copy', 'arrow-left', 'arrow-right', 'search', 'download', 'play', 'pause', 'refresh', 'info', 'warning', 'calendar', 'pin'])
    const ICON_PATHS = {
      check: 'M4 9l3 3 5-6', close: 'M5 5l6 6M11 5l-6 6', plus: 'M8 3v10M3 8h10', minus: 'M3 8h10',
      copy: 'M5 5h6v6H5zM3 11V3h8', 'arrow-left': 'M12 8H4m3-3l-3 3 3 3', 'arrow-right': 'M4 8h8m-3-3l3 3-3 3',
      search: 'M7 3a4 4 0 100 8 4 4 0 000-8zM10 10l3 3', download: 'M8 3v7m-3-3l3 3 3-3M3 13h10',
      play: 'M5 3l8 5-8 5z', pause: 'M5 3v10M11 3v10', refresh: 'M13 8a5 5 0 11-2-4M13 2v3h-3',
      info: 'M8 4v.5M8 7v4M4 14a4 4 0 018 0', warning: 'M8 2l6 11H2zM8 6v3M8 11v.5',
      calendar: 'M3 4h10v9H3zM3 7h10M6 2v3M10 2v3', pin: 'M8 14s4-4 4-7a4 4 0 10-8 0c0 3 4 7 4 7z',
    }

    function Icon({ name }) {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      }, h('path', { d: ICON_PATHS[name] ?? '' }))
    }

    function AppIconButton({ props, ctx, node }) {
      return h('button', {
        type: 'button',
        className: 'iui-icon-btn',
        'aria-label': String(props.label ?? props.icon ?? ''),
        disabled: props.disabled === true,
        onClick: () => ctx.fire(node, 'click'),
      }, h(Icon, { name: props.icon }))
    }

    function AppInput({ props, ctx, node }) {
      const [value, setValue] = useEcho(node, props, '')
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      return h('label', { className: 'iui-field2', htmlFor: id },
        h('span', null, String(props.label ?? ''), props.required === true ? h('b', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, ' *') : null),
        h('input', {
          id,
          className: 'iui-input',
          type: props.type ?? 'text',
          placeholder: props.placeholder,
          value: value ?? '',
          min: props.min,
          max: props.max,
          step: props.step,
          onInput: (event) => {
            const next = props.type === 'number' ? Number(event.target.value) : event.target.value
            setValue(next)
            ctx.fire(node, 'input', next)
          },
          onChange: (event) => {
            const next = props.type === 'number' ? Number(event.target.value) : event.target.value
            setValue(next)
            ctx.fire(node, 'change', next)
          },
        }),
        props.help ? h('span', { className: 'iui-help' }, String(props.help)) : null)
    }

    function AppTextarea({ props, ctx, node }) {
      const [value, setValue] = useEcho(node, props, '')
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      return h('label', { className: 'iui-field2', htmlFor: id },
        h('span', null, String(props.label ?? '')),
        h('textarea', {
          id,
          className: 'iui-input',
          rows: props.rows ?? 4,
          placeholder: props.placeholder,
          value: value ?? '',
          onChange: (event) => {
            setValue(event.target.value)
            ctx.fire(node, 'input', event.target.value)
            ctx.fire(node, 'change', event.target.value)
          },
        }))
    }

    function AppSelect({ props, ctx, node }) {
      const options = optionList(props.options)
      const [value, setValue] = useEcho(node, props, options[0]?.value ?? '')
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      return h('label', { className: 'iui-field2', htmlFor: id },
        h('span', null, String(props.label ?? '')),
        h('select', {
          id,
          className: 'iui-input',
          value: value ?? '',
          onChange: (event) => {
            setValue(event.target.value)
            ctx.fire(node, 'change', event.target.value)
          },
        },
        props.placeholder ? h('option', { value: '' }, String(props.placeholder)) : null,
        options.map((option) => h('option', { key: String(option.value), value: String(option.value) }, option.label))))
    }

    function AppCombobox({ props, ctx, node }) {
      const options = optionList(props.options)
      const [value, setValue] = useEcho(node, props, '')
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      const listId = `dl-${node.id}`
      return h('label', { className: 'iui-field2', htmlFor: id },
        h('span', null, String(props.label ?? '')),
        h('input', {
          id,
          className: 'iui-input',
          list: listId,
          placeholder: props.placeholder,
          value: value ?? '',
          onChange: (event) => {
            setValue(event.target.value)
            ctx.fire(node, 'change', event.target.value)
          },
        }),
        h('datalist', { id: listId }, options.map((option) => h('option', { key: String(option.value), value: String(option.value) }))))
    }

    function AppCheckbox({ props, ctx, node }) {
      const [checked, setChecked] = useEcho(node, props, false)
      useRegisterField(ctx, node, props, checked)
      const id = `f-${node.id}`
      return h('label', { className: 'iui-check', htmlFor: id },
        h('input', {
          id,
          type: 'checkbox',
          checked: Boolean(checked),
          onChange: (event) => {
            setChecked(event.target.checked)
            ctx.fire(node, 'change', event.target.checked)
          },
        }),
        h('span', null, String(props.label ?? '')))
    }

    function AppRadio({ props, ctx, node }) {
      const options = optionList(props.options)
      const [value, setValue] = useEcho(node, props, options[0]?.value ?? '')
      useRegisterField(ctx, node, props, value)
      return h('fieldset', { style: { border: 'none', margin: 0, padding: 0 } },
        h('legend', { className: 'iui-help' }, String(props.label ?? '')),
        h('div', { className: 'iui-col', style: { gap: 6 } }, options.map((option) => h('label', { className: 'iui-check', key: String(option.value) },
          h('input', {
            type: 'radio',
            name: `r-${node.id}`,
            checked: String(value) === String(option.value),
            onChange: () => {
              setValue(option.value)
              ctx.fire(node, 'change', option.value)
            },
          }),
          h('span', null, option.label)))))
    }

    function AppSwitch({ props, ctx, node }) {
      const [checked, setChecked] = useEcho(node, props, false)
      useRegisterField(ctx, node, props, checked)
      return h('label', { className: 'iui-check' },
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': Boolean(checked),
          'aria-label': String(props.label ?? ''),
          className: 'iui-btn iui-btn-ghost',
          onClick: () => {
            const next = !checked
            setChecked(next)
            ctx.fire(node, 'change', next)
          },
        }, h('span', {
          'aria-hidden': true,
          style: {
            width: 30, height: 16, borderRadius: 999, position: 'relative',
            background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
            transition: 'background .15s ease',
          },
        }, h('span', {
          style: {
            position: 'absolute', top: 2, left: checked ? 16 : 2, width: 12, height: 12,
            borderRadius: '50%', background: 'var(--dsw-alias-bg-base)', transition: 'left .15s ease',
          },
        }))),
        h('span', null, String(props.label ?? ''), `: ${checked ? '✓' : '✗'}`))
    }

    function AppSlider({ props, ctx, node }) {
      const min = Number(props.min ?? 0)
      const max = Number(props.max ?? 100)
      const [value, setValue] = useEcho(node, props, min)
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      return h('div', { className: 'iui-field2' },
        h('span', null, String(props.label ?? ''), h('b', { style: { float: 'right' } }, `${fmt(value)}${props.unit ?? ''}`)),
        h('input', {
          id,
          className: 'iui-range',
          type: 'range',
          min,
          max,
          step: props.step ?? (max - min) / 100,
          value: Number.isFinite(value) ? value : min,
          onChange: (event) => {
            const next = Number(event.target.value)
            setValue(next)
            ctx.fire(node, 'change', next)
          },
        }))
    }

    function AppDatePicker({ props, ctx, node }) {
      const [value, setValue] = useEcho(node, props, '')
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      return h('label', { className: 'iui-field2', htmlFor: id },
        h('span', null, String(props.label ?? '')),
        h('input', {
          id,
          className: 'iui-input',
          type: 'date',
          value: value ?? '',
          min: props.min,
          max: props.max,
          onChange: (event) => {
            setValue(event.target.value)
            ctx.fire(node, 'change', event.target.value)
          },
        }))
    }

    function AppTimePicker({ props, ctx, node }) {
      const [value, setValue] = useEcho(node, props, '')
      useRegisterField(ctx, node, props, value)
      const id = `f-${node.id}`
      return h('label', { className: 'iui-field2', htmlFor: id },
        h('span', null, String(props.label ?? '')),
        h('input', {
          id,
          className: 'iui-input',
          type: 'time',
          value: value ?? '',
          onChange: (event) => {
            setValue(event.target.value)
            ctx.fire(node, 'change', event.target.value)
          },
        }))
    }

    function AppSegmented({ props, ctx, node }) {
      const options = optionList(props.options)
      const [value, setValue] = useEcho(node, props, options[0]?.value ?? '')
      return h('div', { className: 'iui-field2' },
        props.label ? h('span', null, String(props.label)) : null,
        h('div', { className: 'iui-seg', role: 'group', 'aria-label': props.label ? String(props.label) : undefined },
          options.map((option) => h('button', {
            key: String(option.value),
            type: 'button',
            'aria-pressed': String(value) === String(option.value),
            onClick: () => {
              setValue(option.value)
              ctx.fire(node, 'change', option.value)
            },
          }, option.label))))
    }

    function AppForm({ props, children, ctx, node }) {
      const fields = useRef(new Map())
      const register = useCallback((field) => {
        fields.current.set(field.id, field)
        return () => fields.current.delete(field.id)
      }, [])
      const submit = (event) => {
        event.preventDefault()
        const all = [...fields.current.values()]
        const missing = all.filter((field) => field.required
          && (field.value === '' || field.value === undefined || field.value === null || field.value === false))
        if (missing.length > 0) {
          ctx.toast(`${ctx.t('missing')}: ${missing.map((field) => field.name).join(', ')}`, 'error')
          return
        }
        const values = Object.fromEntries(all.map((field) => [field.name, field.value]))
        // Success is reported by the action's execution, not by reaching here.
        if (node.on && node.on.submit) ctx.fire(node, 'submit', values)
        else ctx.toast(ctx.t('submitted'), 'success')
      }
      return h('form', { onSubmit: submit, style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        props.title ? h('div', { style: { fontWeight: 600 } }, String(props.title)) : null,
        h(FormContext.Provider, { value: { register } }, children),
        h('button', { type: 'submit', className: 'iui-btn iui-btn-primary' }, String(props.submitLabel ?? ctx.t('submit'))))
    }

    function AppFileUpload({ props, ctx, node }) {
      const [files, setFiles] = useState([])
      const id = `f-${node.id}`
      return h('div', { className: 'iui-field2' },
        h('label', { htmlFor: id }, String(props.label ?? ctx.t('upload'))),
        h('input', {
          id,
          type: 'file',
          accept: props.accept,
          multiple: props.multiple === true,
          onChange: (event) => {
            const picked = [...event.target.files].map((file) => ({ name: file.name, size: file.size }))
            setFiles(picked)
            // The selection is local data; with no upload backend configured,
            // the action receives the file names and the user is not told that
            // anything was transferred.
            ctx.fire(node, 'change', picked)
          },
        }),
        files.length > 0
          ? h('div', { className: 'iui-help' }, files.map((file) => `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`).join(' · '))
          : null)
    }

    function AppDialog({ props, children, ctx, node }) {
      const ref = useRef(null)
      const [selfOpen, setSelfOpen] = useState(false)
      const bound = Boolean(node.bind && Object.prototype.hasOwnProperty.call(node.bind, 'open'))
      const open = bound ? props.open === true : selfOpen
      useEffect(() => {
        const el = ref.current
        if (el === null) return
        if (open && !el.open) el.showModal()
        if (!open && el.open) el.close()
      }, [open])
      const close = (event) => {
        ctx.fire(node, event)
        if (!bound) setSelfOpen(false)
      }
      return h('dialog', {
        ref,
        className: 'iui-dialog',
        onCancel: (event) => { event.preventDefault(); close('cancel') },
      },
      props.title ? h('div', { style: { fontWeight: 600, marginBottom: 8 } }, String(props.title)) : null,
      h('div', { className: 'iui-col' }, children),
      h('div', { className: 'iui-dialog-actions' },
        h('button', { type: 'button', className: 'iui-btn', onClick: () => close('cancel') }, String(props.cancelLabel ?? ctx.t('cancel'))),
        h('button', { type: 'button', className: 'iui-btn iui-btn-primary', onClick: () => close('confirm') }, String(props.confirmLabel ?? ctx.t('confirm')))))
    }

    function AppConfirmDialog({ props, ctx, node }) {
      const ref = useRef(null)
      const [selfOpen, setSelfOpen] = useState(false)
      const bound = Boolean(node.bind && Object.prototype.hasOwnProperty.call(node.bind, 'open'))
      const open = bound ? props.open === true : selfOpen
      useEffect(() => {
        const el = ref.current
        if (el === null) return
        if (open && !el.open) el.showModal()
        if (!open && el.open) el.close()
      }, [open])
      const close = (event) => {
        ctx.fire(node, event)
        if (!bound) setSelfOpen(false)
      }
      return h('dialog', {
        ref,
        className: 'iui-dialog',
        onCancel: (event) => { event.preventDefault(); close('cancel') },
      },
      h('div', { style: { fontWeight: 600 } }, String(props.title ?? '')),
      props.message ? h('div', { style: { marginTop: 8 } }, String(props.message)) : null,
      h('div', { className: 'iui-dialog-actions' },
        h('button', { type: 'button', className: 'iui-btn', onClick: () => close('cancel') }, String(props.cancelLabel ?? ctx.t('cancel'))),
        h('button', {
          type: 'button',
          className: 'iui-btn iui-btn-primary',
          style: props.tone === 'error' ? { background: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' } : undefined,
          onClick: () => close('confirm'),
        }, String(props.confirmLabel ?? ctx.t('confirm')))))
    }

    // ── app components: data visualization ────────────────────────────

    function AppKpi({ props, ctx }) {
      const color = props.tone ? colorFor(props.tone, 0, ctx.colors) : undefined
      return h('div', { className: 'iui-kpi', style: color ? { borderLeft: `3px solid ${color}` } : undefined },
        h('div', { className: 'iui-kpi-value' },
          fmt(props.value),
          props.unit ? h('span', { className: 'iui-kpi-unit' }, String(props.unit)) : null),
        h('div', { className: 'iui-kpi-label' }, String(props.label ?? '')),
        props.delta !== undefined && props.delta !== null
          ? h('div', {
            className: 'iui-kpi-delta',
            style: { color: Number(props.delta) >= 0 ? colors0(ctx).success : colors0(ctx).error },
          }, `${Number(props.delta) >= 0 ? '▲' : '▼'} ${fmt(Math.abs(Number(props.delta)))}${props.unit ?? ''}`)
          : null,
        props.hint ? h('div', { className: 'iui-help' }, String(props.hint)) : null)
    }

    /** Theme snapshot colors for semantic deltas. */
    function colors0(ctx) {
      return ctx.colors ?? readColors()
    }

    function AppProgress({ props, ctx, node }) {
      if (props.variant === 'bar') {
        const max = Number(props.max ?? 100)
        const pct = Math.max(0, Math.min(Number(props.value ?? 0) / (max || 1), 1))
        return h('div', { className: 'iui-col', style: { gap: 6 } },
          h('div', { className: 'iui-result-row' },
            h('span', null, String(props.label ?? '')),
            h('b', null, `${fmt(props.value)}${props.unit ?? ''} · ${Math.round(pct * 100)}%`)),
          h('div', {
            className: 'iui-progress-bar',
            role: 'progressbar',
            'aria-valuenow': Number(props.value ?? 0),
            'aria-valuemin': 0,
            'aria-valuemax': max,
            'aria-label': String(props.label ?? ''),
          },
          h('div', {
            className: 'iui-progress-fill',
            style: {
              width: `${pct * 100}%`,
              background: props.tone ? colorFor(props.tone, 0, ctx.colors) : undefined,
            },
          })))
      }
      // Ring variant: the fixed `progress` card draws it, so both spellings
      // show the same ring.
      return h(Progress, {
        spec: {
          kind: 'progress',
          value: Number(props.value ?? 0),
          max: Number(props.max ?? 100),
          label: props.label,
          unit: props.unit,
          tone: props.tone,
        },
        colors: ctx.colors,
        t: ctx.t,
      })
    }

    function AppChart({ props, ctx }) {
      // Series data is the one prop a model most often fabricates at the wrong
      // shape; a malformed point drops out instead of crashing the chart (and
      // its plain-bar fallback) down to the node error box.
      const series = (Array.isArray(props.series) ? props.series : [])
        .filter((point) => point !== null && typeof point === 'object')
        .map((point) => ({
          label: String(point.label ?? ''),
          value: Number(point.value) || 0,
          ...point.tone === undefined ? {} : { tone: point.tone },
          ...point.hint === undefined ? {} : { hint: point.hint },
          ...Number.isFinite(point.x) ? { x: point.x } : {},
        }))
      const spec = {
        kind: 'chart',
        variant: props.variant ?? 'bar',
        series,
        unit: props.unit,
      }
      const height = props.height ?? 220
      return h('div', { className: 'iui-col', style: { gap: 6 } },
        props.label ? h('div', { className: 'iui-kpi-label' }, String(props.label)) : null,
        h('div', { style: { height } }, h(Chart, { spec, colors: ctx.colors, t: ctx.t })))
    }

    /**
     * A working data table: sort, search, column filter, pagination, row
     * selection and CSV export. All of it local — the schema hands over the
     * rows, the user's controls reshape only the view.
     */
    function AppDataTable({ props, ctx, node }) {
      const columns = useMemo(() => (Array.isArray(props.columns) ? props.columns : []).map((column, index) => (
        typeof column === 'object' && column !== null
          ? {
            key: String(column.key ?? index),
            label: String(column.label ?? column.key ?? index),
            align: column.align,
            sortable: column.sortable !== false,
          }
          : { key: String(index), label: String(column ?? index), align: undefined, sortable: true }
      )), [props.columns])

      const rows = useMemo(() => (Array.isArray(props.rows) ? props.rows : []).map((row) => (
        Array.isArray(row)
          ? row.map((cell) => cell)
          : columns.map((column) => (row && typeof row === 'object' ? row[column.key] : undefined))
      )), [props.rows, columns])

      const [sort, setSort] = useState(null)          // {key, dir: 1|-1}
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('')
      const [page, setPage] = useState(0)
      const [selected, setSelected] = useState(() => new Set())
      const pageSize = Math.max(1, Number(props.pageSize ?? 10))

      const filterIndex = useMemo(
        () => columns.findIndex((column) => column.key === String(props.filterKey ?? '')),
        [columns, props.filterKey],
      )
      const filterValues = useMemo(() => {
        if (filterIndex < 0) return []
        return [...new Set(rows.map((row) => String(row[filterIndex] ?? '')))].sort()
      }, [rows, filterIndex])

      const view = useMemo(() => {
        let out = rows.map((row, index) => ({ row, index }))
        if (props.search === true && query.trim() !== '') {
          const needle = query.trim().toLowerCase()
          out = out.filter((entry) => entry.row.some((cell) => String(cell ?? '').toLowerCase().includes(needle)))
        }
        if (filterIndex >= 0 && filter !== '') {
          out = out.filter((entry) => String(entry.row[filterIndex] ?? '') === filter)
        }
        if (sort !== null) {
          const column = columns.findIndex((c) => c.key === sort.key)
          if (column >= 0) {
            out = out.slice().sort((a, b) => {
              const av = a.row[column]
              const bv = b.row[column]
              const an = Number(av)
              const bn = Number(bv)
              if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sort.dir
              return String(av ?? '').localeCompare(String(bv ?? '')) * sort.dir
            })
          }
        }
        return out
      }, [rows, query, filter, sort, columns, filterIndex])

      const pages = Math.max(1, Math.ceil(view.length / pageSize))
      const current = Math.min(page, pages - 1)
      const slice = view.slice(current * pageSize, current * pageSize + pageSize)

      const toggleSort = (column) => {
        if (!column.sortable) return
        setSort((value) => (value && value.key === column.key
          ? { key: column.key, dir: -value.dir }
          : { key: column.key, dir: 1 }))
      }
      const toggleRow = (index) => {
        setSelected((value) => {
          const next = new Set(value)
          if (next.has(index)) next.delete(index)
          else next.add(index)
          return next
        })
      }
      const exportCsv = () => {
        const esc = (cell) => {
          const text = String(cell ?? '')
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
        }
        const csv = [columns.map((column) => esc(column.label)).join(',')]
          .concat(view.map((entry) => entry.row.map(esc).join(',')))
          .join('\n')
        const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = 'table.csv'
        link.click()
        URL.revokeObjectURL(url)
        ctx.toast(ctx.t('export'), 'success')
      }

      return h('div', null,
        h('div', { className: 'iui-table-tools' },
          props.search === true ? h('input', {
            className: 'iui-input',
            type: 'search',
            placeholder: ctx.t('search'),
            'aria-label': ctx.t('search'),
            value: query,
            style: { maxWidth: 200 },
            onChange: (event) => { setQuery(event.target.value); setPage(0) },
          }) : null,
          filterIndex >= 0 ? h('select', {
            className: 'iui-input',
            'aria-label': ctx.t('filter'),
            value: filter,
            style: { maxWidth: 200 },
            onChange: (event) => { setFilter(event.target.value); setPage(0) },
          },
          h('option', { value: '' }, `${ctx.t('filter')}: ${ctx.t('all')}`),
          filterValues.map((value) => h('option', { key: value, value }, value))) : null,
          props.selectable === true ? h('span', { className: 'iui-help' }, `${selected.size} ${ctx.t('rowsSelected')}`) : null,
          props.exportable === true ? h('button', {
            type: 'button', className: 'iui-btn iui-btn-ghost', onClick: exportCsv,
          }, ctx.t('export')) : null),
        h(TableScroll, { rows: slice.length, label: `${ctx.t('table')}: ${columns.length} × ${rows.length}` },
          h('table', { className: 'iui-table' },
            h('thead', null, h('tr', null,
              props.selectable === true ? h('th', { scope: 'col' }, '') : null,
              columns.map((column) => h('th', {
                key: column.key,
                scope: 'col',
                style: { textAlign: column.align ?? 'left' },
              }, column.sortable
                ? h('button', {
                  type: 'button',
                  className: 'iui-sort',
                  style: { background: 'transparent', border: 'none', font: 'inherit', color: 'inherit', padding: 0 },
                  onClick: () => toggleSort(column),
                  'aria-label': `${ctx.t('sort')}: ${column.label}`,
                }, `${column.label}${sort && sort.key === column.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}`)
                : column.label)))),
            h('tbody', null, slice.map((entry) => h('tr', { key: entry.index },
              props.selectable === true ? h('td', null, h('input', {
                type: 'checkbox',
                checked: selected.has(entry.index),
                'aria-label': `${ctx.t('rowsSelected')} ${entry.index + 1}`,
                onChange: () => toggleRow(entry.index),
              })) : null,
              entry.row.map((cell, cellIndex) => h('td', {
                key: cellIndex,
                className: cellIndex === 0 ? 'iui-rowhead' : undefined,
                style: { textAlign: columns[cellIndex]?.align ?? (cellIndex === 0 ? 'left' : undefined) },
              }, String(cell ?? '')))))))),
        props.caption ? h('div', { className: 'iui-caption' }, String(props.caption)) : null,
        view.length === 0 ? h('div', { className: 'iui-help', style: { marginTop: 8 } }, String(props.emptyText ?? ctx.t('noResults'))) : null,
        pages > 1 ? h('div', { className: 'iui-table-foot' },
          h('span', null, `${ctx.t('page')} ${current + 1} / ${pages}`),
          h('span', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', className: 'iui-btn iui-btn-ghost', disabled: current === 0, onClick: () => setPage(current - 1) }, ctx.t('prev')),
            h('button', { type: 'button', className: 'iui-btn iui-btn-ghost', disabled: current >= pages - 1, onClick: () => setPage(current + 1) }, ctx.t('next')))) : null)
    }

    // ── app components: media and map ─────────────────────────────────

    function AppImage({ props, ctx }) {
      const [failed, setFailed] = useState(false)
      const src = typeof props.src === 'string' ? props.src : ''
      if (failed || src === '') {
        return h('div', { className: 'iui-img-fallback' },
          h('div', null, ctx.t('imageFailed')),
          src !== '' ? h('div', { className: 'iui-help' }, src) : null)
      }
      return h('figure', { style: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
        h('img', {
          src,
          alt: String(props.alt ?? ''),
          loading: 'lazy',
          onError: () => setFailed(true),
          style: {
            width: props.width ?? '100%',
            maxWidth: '100%',
            borderRadius: 8,
            objectFit: props.fit ?? 'cover',
          },
        }),
        props.caption ? h('figcaption', { className: 'iui-help' }, String(props.caption)) : null)
    }

    /** Fullscreen viewer shared by `gallery` and `lightbox`. */
    function Viewer({ items, index, setIndex, close, t }) {
      const item = items[index]
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') close()
          if (event.key === 'ArrowRight') setIndex((index + 1) % items.length)
          if (event.key === 'ArrowLeft') setIndex((index - 1 + items.length) % items.length)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [index, items.length, close, setIndex])
      return h('div', { className: 'iui-lightbox', role: 'dialog', 'aria-modal': true, 'aria-label': t('slide') },
        h('img', { src: item?.src, alt: String(item?.alt ?? '') }),
        h('div', { className: 'iui-lightbox-bar' },
          items.length > 1 ? h('button', { type: 'button', className: 'iui-btn', onClick: () => setIndex((index - 1 + items.length) % items.length) }, t('prev')) : null,
          h('span', null, item?.caption ?? `${index + 1} / ${items.length}`),
          items.length > 1 ? h('button', { type: 'button', className: 'iui-btn', onClick: () => setIndex((index + 1) % items.length) }, t('next')) : null,
          h('button', { type: 'button', className: 'iui-btn', onClick: close }, t('close'))))
    }

    function AppGallery({ props, ctx }) {
      const items = useMemo(() => (Array.isArray(props.images) ? props.images : [])
        .filter((image) => image && typeof image === 'object')
        .map((image) => ({ src: String(image.src ?? ''), alt: String(image.alt ?? ''), caption: image.caption })), [props.images])
      const [open, setOpen] = useState(null)
      const columns = Math.min(Math.max(Number(props.columns ?? 3), 1), 4)
      return h('div', { className: 'iui-gallery', style: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } },
        items.map((image, index) => h('button', {
          key: index,
          type: 'button',
          className: 'iui-thumb',
          style: { height: props.height ?? 120 },
          'aria-label': `${ctx.t('slide')} ${index + 1}`,
          onClick: () => setOpen(index),
        }, h(AppImage, { props: { ...image, width: '100%', fit: 'cover' }, ctx }))),
        open !== null ? h(Viewer, {
          items, index: open,
          setIndex: (next) => setOpen(next),
          close: () => setOpen(null),
          t: ctx.t,
        }) : null)
    }

    function AppLightbox({ props, ctx }) {
      const items = [{ src: String(props.src ?? ''), alt: String(props.alt ?? ''), caption: props.caption }]
      const [open, setOpen] = useState(false)
      return h('div', null,
        h('button', {
          type: 'button',
          className: 'iui-thumb',
          style: { width: props.width ?? '100%', height: 140, cursor: 'zoom-in' },
          'aria-label': String(props.alt ?? ctx.t('slide')),
          onClick: () => setOpen(true),
        }, h(AppImage, { props: { ...props, width: '100%', fit: 'cover' }, ctx })),
        open ? h(Viewer, { items, index: 0, setIndex: () => {}, close: () => setOpen(false), t: ctx.t }) : null)
    }

    function AppVideo({ props, ctx }) {
      const src = typeof props.src === 'string' ? props.src : ''
      if (src === '') return h('div', { className: 'iui-img-fallback' }, ctx.t('empty'))
      return h('figure', { style: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
        h('video', {
          src,
          poster: props.poster,
          controls: true,
          preload: 'metadata',
          style: { width: '100%', borderRadius: 8, background: '#000' },
        }),
        props.caption ? h('figcaption', { className: 'iui-help' }, String(props.caption)) : null)
    }

    /**
     * A schematic SVG figure from a small safe shape vocabulary.
     *
     * The model names shapes and whitelisted attributes; the Client builds real
     * SVG elements. Raw markup is never injected, which is what keeps a
     * generated `svg` node as safe as every other node.
     */
    const SVG_SHAPES = {
      rect: ['x', 'y', 'width', 'height', 'rx', 'fill', 'stroke', 'strokeWidth', 'opacity'],
      circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'strokeWidth', 'opacity'],
      ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'strokeWidth', 'opacity'],
      line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth', 'opacity'],
      path: ['d', 'fill', 'stroke', 'strokeWidth', 'opacity'],
      text: ['x', 'y', 'fill', 'fontSize', 'textAnchor', 'text'],
      arrow: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth'],
    }

    function AppSvg({ props, ctx }) {
      const shapes = Array.isArray(props.shapes) ? props.shapes : []
      return h('figure', { style: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
        h('svg', {
          viewBox: String(props.viewBox ?? '0 0 400 200'),
          className: 'iui-map',
          role: 'img',
          'aria-label': String(props.caption ?? 'svg'),
        },
        h('defs', null, h('marker', {
          id: 'iui-arrowhead', viewBox: '0 0 10 10', refX: 9, refY: 5,
          markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
        }, h('path', { d: 'M0 0L10 5L0 10z', fill: 'currentColor' }))),
        shapes.map((shape, index) => {
          const type = String(shape?.type ?? '')
          const allowed = SVG_SHAPES[type]
          if (allowed === undefined) return null
          const attrs = {}
          for (const key of allowed) {
            if (shape[key] !== undefined && key !== 'text') attrs[key] = shape[key]
          }
          if (type === 'arrow') {
            return h('line', {
              key: index, ...attrs,
              markerEnd: 'url(#iui-arrowhead)',
            })
          }
          return h(type === 'text' ? 'text' : type, { key: index, ...attrs }, type === 'text' ? String(shape.text ?? '') : undefined)
        })),
        props.caption ? h('figcaption', { className: 'iui-help' }, String(props.caption)) : null)
    }

    function AppDiagram({ props, ctx }) {
      const source = String(props.mermaid ?? '')
      if (source === '') return h('div', { className: 'iui-empty' }, ctx.t('empty'))
      return h(Mermaid, { source, colors: ctx.colors, t: ctx.t })
    }

    /**
     * A schematic map: equirectangular projection of the declared places onto
     * an SVG plane, with markers, a selected-place popup and a linked list.
     *
     * ponytail: MapLibre/Leaflet were dropped — both need raster tiles from a
     * network service (no offline map) and a much larger payload inside a chat
     * card. Ceiling: a schematic plane, no pan/zoom/tiles; upgrade path: swap
     * this component for a tile-based one behind the same node type when a
     * tile endpoint is available.
     */
    function AppMap({ props, ctx, node }) {
      const places = useMemo(() => (Array.isArray(props.places) ? props.places : [])
        .filter((place) => place && typeof place === 'object')
        .map((place) => ({
          id: String(place.id ?? place.name ?? ''),
          name: String(place.name ?? place.id ?? ''),
          lat: Number(place.lat ?? 0),
          lng: Number(place.lng ?? 0),
          label: place.label,
        })), [props.places])

      const width = 720
      const height = Math.max(160, Number(props.height ?? 260))
      const padding = 28
      const projection = useMemo(() => {
        if (places.length === 0) return null
        const lats = places.map((place) => place.lat)
        const lngs = places.map((place) => place.lng)
        const minLat = Math.min(...lats)
        const maxLat = Math.max(...lats)
        const minLng = Math.min(...lngs)
        const maxLng = Math.max(...lngs)
        const spanLat = Math.max(maxLat - minLat, 0.5)
        const spanLng = Math.max(maxLng - minLng, 0.5)
        return {
          toX: (lng) => padding + ((lng - minLng) / spanLng) * (width - padding * 2),
          // Latitude grows northwards, SVG y grows downwards.
          toY: (lat) => height - padding - ((lat - minLat) / spanLat) * (height - padding * 2),
        }
      }, [places, height])

      const selected = props.selected === undefined ? null : String(props.selected)
      const active = places.find((place) => place.id === selected) ?? null

      return h('figure', {
        style: {
          margin: 0, display: 'flex', flexDirection: 'column', gap: 6,
          // In a row layout the map must keep a usable width instead of
          // collapsing to its marker content.
          flex: '1 1 300px', minWidth: 220,
        },
      },
      h('svg', {
        className: 'iui-map',
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': String(props.caption ?? 'map'),
      },
        projection === null ? null : places.map((place) => {
          const x = projection.toX(place.lng)
          const y = projection.toY(place.lat)
          const isActive = place.id === selected
          return h('g', {
            key: place.id,
            className: 'iui-map-marker',
            role: 'button',
            tabIndex: 0,
            'aria-label': place.name,
            'aria-current': isActive,
            onClick: () => ctx.fire(node, 'change', place.id),
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') ctx.fire(node, 'change', place.id) },
          },
          h('circle', {
            cx: x, cy: y, r: isActive ? 9 : 6,
            fill: isActive ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-base)',
            stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 2,
          }),
          h('text', {
            x, y: y - 14, textAnchor: 'middle',
            fontSize: 11, fill: 'var(--dsw-alias-label-secondary)',
          }, place.label ?? place.name))
        })),
        active ? h('div', { className: 'iui-result-row', role: 'status' },
          h('span', null, active.name),
          h('b', null, `${active.lat.toFixed(2)}, ${active.lng.toFixed(2)}`)) : null,
        props.caption ? h('figcaption', { className: 'iui-help' }, String(props.caption)) : null)
    }

    function AppPlaces({ props, ctx, node }) {
      const places = Array.isArray(props.places) ? props.places : []
      const selected = props.selected === undefined ? null : String(props.selected)
      return h('div', { className: 'iui-col', style: { gap: 6, flex: '1 1 240px', minWidth: 200 } },
        props.label ? h('div', { className: 'iui-kpi-label' }, String(props.label)) : null,
        h('ul', { className: 'iui-places' }, places.map((place, index) => {
          const id = String(place?.id ?? place?.name ?? index)
          return h('li', { key: id },
            h('button', {
              type: 'button',
              className: 'iui-place',
              'aria-current': id === selected,
              onClick: () => ctx.fire(node, 'change', id),
            },
            h('span', null, String(place?.name ?? id)),
            place?.label ? h('span', { className: 'iui-help' }, String(place.label)) : null))
        })))
    }

    // ── app components: system feedback ────────────────────────────────

    function AppToast({ props }) {
      const items = Array.isArray(props.items) ? props.items : []
      return h('div', { className: 'iui-toast-stack', role: 'status', 'aria-live': 'polite' },
        items.map((item, index) => {
          const entry = typeof item === 'object' && item !== null ? item : { text: String(item ?? '') }
          return h('div', { key: index, className: 'iui-toast-item', 'data-tone': entry.tone ?? 'info' },
            h('span', null, String(entry.text ?? '')))
        }))
    }

    function ToastStack({ toasts, t }) {
      if (toasts.length === 0) return null
      return h('div', { className: 'iui-toast-stack', role: 'status', 'aria-live': 'polite' },
        toasts.map((item) => h('div', { key: item.id, className: 'iui-toast-item', 'data-tone': item.tone },
          h('span', null, item.text),
          h('span', { className: 'iui-help' }, t('close')))))
    }

    function AppLoading({ props, ctx }) {
      return h('div', { className: 'iui-row', role: 'status', 'aria-live': 'polite' },
        h('span', { className: 'iui-spinner', 'aria-hidden': true }),
        h('span', null, String(props.label ?? ctx.t('loading'))))
    }

    function AppSkeleton({ props }) {
      const lines = Math.min(Math.max(Number(props.lines ?? 3), 1), 12)
      return h('div', {
        className: 'iui-col',
        style: { gap: 8 },
        role: 'status',
        'aria-label': 'loading',
      }, Array.from({ length: lines }, (_, index) => h('div', {
        key: index,
        className: 'iui-skeleton',
        style: { height: props.height ?? 12, width: index === lines - 1 ? '60%' : '100%' },
      })))
    }

    function AppErrorState({ props, ctx, node }) {
      return h('div', { className: 'iui-node-error', role: 'alert' },
        h('div', null, String(props.message ?? ctx.t('nodeError'))),
        props.hint ? h('div', { className: 'iui-help' }, String(props.hint)) : null,
        node.on && node.on.click ? h('button', {
          type: 'button', className: 'iui-btn', style: { marginTop: 8 },
          onClick: () => ctx.fire(node, 'click'),
        }, String(props.retryLabel ?? ctx.t('retry'))) : null)
    }

    function AppEmptyState({ props, ctx }) {
      return h('div', { className: 'iui-empty', style: { textAlign: 'center', padding: '18px 0' } },
        h('div', null, String(props.message ?? ctx.t('empty'))),
        props.hint ? h('div', { className: 'iui-help' }, String(props.hint)) : null)
    }

    function AppChecklist({ props, ctx, node }) {
      const items = Array.isArray(props.items) ? props.items : []
      const [done, setDone] = useState(() => items.map((item) => Boolean(item?.done)))
      const toggle = (index) => {
        setDone((current) => {
          const next = current.slice()
          next[index] = !next[index]
          ctx.fire(node, 'change', { index, done: next[index] })
          return next
        })
      }
      return h('div', { className: 'iui-col', style: { gap: 6 } },
        props.label ? h('div', { className: 'iui-kpi-label' }, String(props.label)) : null,
        items.map((item, index) => h('label', { className: 'iui-check', key: index },
          h('input', { type: 'checkbox', checked: Boolean(done[index]), onChange: () => toggle(index) }),
          h('span', {
            style: done[index] ? { textDecoration: 'line-through', color: 'var(--dsw-alias-label-secondary)' } : undefined,
          }, String(item?.text ?? item ?? '')))))
    }

    function AppStepper({ props, ctx, node }) {
      const steps = Array.isArray(props.steps) ? props.steps : []
      const bound = Boolean(node.bind && Object.prototype.hasOwnProperty.call(node.bind, 'current'))
      const [local, setLocal] = useState(0)
      const current = bound ? Math.min(Math.max(Number(props.current ?? 0), 0), Math.max(steps.length - 1, 0)) : Math.min(local, Math.max(steps.length - 1, 0))
      const go = (next) => {
        const clamped = Math.min(Math.max(next, 0), Math.max(steps.length - 1, 0))
        if (!bound) setLocal(clamped)
        ctx.fire(node, 'change', clamped)
      }
      return h('div', { className: 'iui-col', style: { gap: 8 } },
        h('ol', { className: 'iui-steps' }, steps.map((step, index) => {
          const entry = typeof step === 'object' && step !== null ? step : { label: String(step ?? '') }
          return h('li', { className: 'iui-step', key: index, style: index === current ? { fontWeight: 600 } : undefined },
            h('div', {
              className: 'iui-step-n',
              'aria-hidden': true,
              style: index <= current ? { background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-bg-base)' } : undefined,
            }, index + 1),
            h('div', null,
              h('div', null, String(entry.label ?? entry.text ?? '')),
              entry.detail ? h('div', { className: 'iui-step-detail' }, String(entry.detail)) : null))
        })),
        h('div', { className: 'iui-row' },
          h('button', { type: 'button', className: 'iui-btn iui-btn-ghost', disabled: current === 0, onClick: () => go(current - 1) }, ctx.t('prev')),
          h('span', { className: 'iui-help' }, `${ctx.t('step')} ${current + 1} / ${Math.max(steps.length, 1)}`),
          h('button', { type: 'button', className: 'iui-btn iui-btn-ghost', disabled: current >= steps.length - 1, onClick: () => go(current + 1) }, ctx.t('next'))))
    }

    // ── app components: instant micro-apps ─────────────────────────────

    function AppQuiz({ props, ctx, node }) {
      const questions = useMemo(() => (Array.isArray(props.questions) ? props.questions : [])
        .map((question) => ({
          question: String(question?.question ?? ''),
          options: (Array.isArray(question?.options) ? question.options : []).map(String),
          answer: Number(question?.answer ?? 0),
          explanation: question?.explanation,
        })), [props.questions])
      const [index, setIndex] = useState(0)
      const [picked, setPicked] = useState({})   // question index → chosen option index
      const score = questions.reduce((total, question, i) => (
        total + (picked[i] === question.answer ? 1 : 0)), 0)
      const question = questions[index]
      const answered = picked[index] !== undefined

      const choose = (optionIndex) => {
        if (answered) return
        const next = { ...picked, [index]: optionIndex }
        setPicked(next)
        // The action sees the running score; a full score is the natural moment
        // for a `set` action to flip a "passed" flag in state.
        ctx.fire(node, 'change', {
          score: questions.reduce((total, q, i) => total + (next[i] === q.answer ? 1 : 0), 0),
          total: questions.length,
          index,
        })
      }

      return h('div', { className: 'iui-col', style: { gap: 10 } },
        props.title ? h(AppTitle, { props: { text: props.title, level: 3 } }) : null,
        question === undefined ? h(AppEmptyState, { props: {}, ctx }) : h('div', { className: 'iui-col', style: { gap: 8 } },
          h('div', { className: 'iui-kpi-label' }, `${ctx.t('question')} ${index + 1} / ${questions.length}`),
          h('div', { style: { fontWeight: 600 } }, question.question),
          h('div', { className: 'iui-col', style: { gap: 6 } }, question.options.map((option, optionIndex) => h('button', {
            key: optionIndex,
            type: 'button',
            className: 'iui-quiz-option',
            'data-state': answered
              ? optionIndex === question.answer ? 'right' : picked[index] === optionIndex ? 'wrong' : undefined
              : undefined,
            onClick: () => choose(optionIndex),
          }, option))),
          answered && question.explanation
            ? h('div', { className: 'iui-help' }, String(question.explanation))
            : null,
          h('div', { className: 'iui-row' },
            h('button', { type: 'button', className: 'iui-btn iui-btn-ghost', disabled: index === 0, onClick: () => setIndex(index - 1) }, ctx.t('prev')),
            h('button', { type: 'button', className: 'iui-btn iui-btn-ghost', disabled: index >= questions.length - 1, onClick: () => setIndex(index + 1) }, ctx.t('next')),
            h('button', {
              type: 'button', className: 'iui-btn',
              onClick: () => {
                setPicked({})
                setIndex(0)
                ctx.fire(node, 'click', { reset: true })
              },
            }, ctx.t('reset')))),
        h('div', { className: 'iui-result-row iui-total' },
          h('span', null, ctx.t('score')),
          h('b', null, `${score} / ${questions.length}`)))
    }

    function AppFlashcard({ props, ctx, node }) {
      const cards = useMemo(() => (Array.isArray(props.cards) ? props.cards : [])
        .map((card) => ({
          front: String(card?.front ?? card?.question ?? ''),
          back: String(card?.back ?? card?.answer ?? ''),
        })), [props.cards])
      const [index, setIndex] = useState(0)
      const [flipped, setFlipped] = useState(false)
      const card = cards[index]
      return h('div', { className: 'iui-col', style: { gap: 10 } },
        props.title ? h(AppTitle, { props: { text: props.title, level: 3 } }) : null,
        card === undefined ? h(AppEmptyState, { props: {}, ctx }) : h('div', {
          className: 'iui-flashcard',
          role: 'button',
          tabIndex: 0,
          'aria-label': ctx.t('flip'),
          onClick: () => {
            setFlipped((value) => !value)
            ctx.fire(node, 'click', { index, flipped: !flipped })
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setFlipped((value) => !value)
              ctx.fire(node, 'click', { index, flipped: !flipped })
            }
          },
        }, flipped ? card.back : card.front),
        h('div', { className: 'iui-row' },
          h('button', {
            type: 'button', className: 'iui-btn iui-btn-ghost',
            onClick: () => { setIndex((index - 1 + Math.max(cards.length, 1)) % Math.max(cards.length, 1)); setFlipped(false) },
          }, ctx.t('prev')),
          h('span', { className: 'iui-help' }, `${index + 1} / ${Math.max(cards.length, 1)}`),
          h('button', {
            type: 'button', className: 'iui-btn iui-btn-ghost',
            onClick: () => { setIndex((index + 1) % Math.max(cards.length, 1)); setFlipped(false) },
          }, ctx.t('next')),
          h('button', { type: 'button', className: 'iui-btn', onClick: () => setFlipped((value) => !value) }, ctx.t('flip'))))
    }

    function AppCountdown({ props, ctx, node }) {
      const target = useMemo(() => {
        if (typeof props.target === 'string') {
          const parsed = Date.parse(props.target)
          return Number.isFinite(parsed) ? parsed : null
        }
        return null
      }, [props.target])
      const [remaining, setRemaining] = useState(() => (
        target !== null ? Math.max(0, Math.round((target - Date.now()) / 1000))
          : Math.max(0, Number(props.seconds ?? 0))))
      const [running, setRunning] = useState(true)

      useEffect(() => {
        if (!running || remaining <= 0) return undefined
        const timer = setInterval(() => {
          setRemaining((value) => {
            const next = target !== null
              ? Math.max(0, Math.round((target - Date.now()) / 1000))
              : Math.max(0, value - 1)
            if (next === 0) ctx.fire(node, 'change', 0)
            return next
          })
        }, 1000)
        return () => clearInterval(timer)
      }, [running, remaining, target, ctx, node])

      const cells = [
        [Math.floor(remaining / 86400), 'd'],
        [Math.floor((remaining % 86400) / 3600), 'h'],
        [Math.floor((remaining % 3600) / 60), 'm'],
        [remaining % 60, 's'],
      ]
      return h('div', { className: 'iui-col', style: { gap: 8 } },
        props.label ? h('div', { className: 'iui-kpi-label' }, String(props.label)) : null,
        h('div', { className: 'iui-countdown', role: 'timer', 'aria-live': 'off' },
          cells.map(([value, unit]) => h('div', { className: 'iui-count-cell', key: unit },
            h('div', { className: 'iui-count-num' }, String(value).padStart(2, '0')),
            h('div', { className: 'iui-count-unit' }, unit)))),
        remaining === 0
          ? h('div', { role: 'status' }, ctx.t('expires'))
          : h('div', { className: 'iui-row' },
            h('button', {
              type: 'button', className: 'iui-btn iui-btn-ghost',
              onClick: () => {
                setRunning((value) => {
                  ctx.fire(node, 'click', { running: !value })
                  return !value
                })
              },
            }, running ? ctx.t('pause') : ctx.t('start')),
            h('button', {
              type: 'button', className: 'iui-btn iui-btn-ghost',
              onClick: () => {
                setRemaining(target !== null ? Math.max(0, Math.round((target - Date.now()) / 1000)) : Math.max(0, Number(props.seconds ?? 0)))
                ctx.fire(node, 'click', { reset: true })
              },
            }, ctx.t('reset'))))
    }

    // ── the component registry ─────────────────────────────────────────
    //
    // The Client half of the registry: `type` name → component. The Host's
    // `engine.cjs` carries the same names with their props and child rules, so
    // a spec that passed validation always finds its component here.

    const REGISTRY = {
      text: AppText, title: AppTitle, caption: AppCaption, label: AppLabel,
      bold: AppBold, italic: AppItalic, badge: AppBadge, link: AppLink, quote: AppQuote,
      markdown: AppMarkdown, code: AppCode, math: AppMath, list: AppList,
      timeline: AppTimeline, sources: AppSources,
      box: AppBox, row: AppRow, column: AppColumn, card: AppCard, grid: AppGrid,
      bento: AppBento, flow: AppFlow, divider: AppDivider, spacer: AppSpacer,
      tabs: AppTabs, tab: AppTab, accordion: AppAccordion, accordionItem: AppAccordionItem,
      popover: AppPopover, tooltip: AppTooltip, carousel: AppCarousel, responsive: AppResponsive,
      button: AppButton, iconButton: AppIconButton, input: AppInput, textarea: AppTextarea,
      select: AppSelect, combobox: AppCombobox, checkbox: AppCheckbox, radio: AppRadio,
      switch: AppSwitch, slider: AppSlider, datePicker: AppDatePicker, timePicker: AppTimePicker,
      segmented: AppSegmented, form: AppForm, fileUpload: AppFileUpload,
      dialog: AppDialog, confirmDialog: AppConfirmDialog,
      kpi: AppKpi, progress: AppProgress, chart: AppChart, dataTable: AppDataTable,
      image: AppImage, gallery: AppGallery, lightbox: AppLightbox, video: AppVideo,
      svg: AppSvg, diagram: AppDiagram, map: AppMap, places: AppPlaces,
      toast: AppToast, loading: AppLoading, skeleton: AppSkeleton,
      errorState: AppErrorState, emptyState: AppEmptyState,
      checklist: AppChecklist, stepper: AppStepper,
      quiz: AppQuiz, flashcard: AppFlashcard, countdown: AppCountdown,
      // Chart aliases: one component, six spellings.
      barChart: AppChart, lineChart: AppChart, areaChart: AppChart,
      pieChart: AppChart, donutChart: AppChart, scatterChart: AppChart,
    }

    /**
     * One rendered app: runtime state, the node tree, action feedback, and —
     * when the spec asks for it — Mock Streaming.
     *
     * With `stream: {mode: "mock"}` the finished tree is replayed as a stream
     * of `node.add` events through `StreamPlayer`, at `intervalMs` per event:
     * the first usable component appears immediately and the rest grows in,
     * exactly as a real LLM stream would arrive. The player's own bookkeeping
     * (sequence numbers, duplicates, out-of-order repair, `stream.error` +
     * resume) is the same code a real SSE source will drive — `createSseSource`
     * below is the reserved integration point and reports "not connected".
     */
    function AppSurface({ engine, spec, colors, t }) {
      const runtime = useAppRuntime(engine, spec, t)
      const streaming = Boolean(spec.stream && spec.stream.mode === 'mock')
      const [tree, setTree] = useState(() => (streaming ? null : spec.tree))
      const [stream, setStream] = useState(() => ({ status: streaming ? 'streaming' : 'done', message: null }))
      const timerRef = useRef(null)

      const startStream = useCallback(() => {
        if (timerRef.current !== null) clearInterval(timerRef.current)
        const session = `mock-${spec.tree.id}`
        const player = new engine.StreamPlayer({
          session,
          onUpdate: ({ tree: next, status, errorMessage }) => {
            setTree(next)
            setStream({ status, message: errorMessage })
          },
        })
        const events = engine.mockStreamEvents(spec.tree, { session })
        const interval = spec.stream?.intervalMs ?? 90
        let cursor = 0
        timerRef.current = setInterval(() => {
          if (cursor >= events.length) {
            clearInterval(timerRef.current)
            timerRef.current = null
            return
          }
          player.push(events[cursor])
          cursor += 1
        }, interval)
      }, [engine, spec])

      useEffect(() => {
        if (!streaming) {
          setTree(spec.tree)
          return undefined
        }
        startStream()
        return () => {
          if (timerRef.current !== null) clearInterval(timerRef.current)
        }
      }, [streaming, startStream, spec.tree])

      const ctx = useMemo(() => ({
        engine,
        scope: runtime.scope,
        dispatch: runtime.dispatch,
        fire: runtime.fire,
        toast: runtime.toast,
        colors,
        t,
      }), [engine, runtime.scope, runtime.dispatch, runtime.fire, runtime.toast, colors, t])

      return h('div', { className: 'iui-app' },
        h(ToastStack, { toasts: runtime.toasts, t }),
        tree === null
          ? h('div', { className: 'iui-empty' }, t('preparing'))
          : h(AppNode, { node: tree, ctx }),
        streaming ? h('div', { className: 'iui-stream-bar' },
          h('span', {
            className: stream.status === 'streaming' ? 'iui-spinner' : undefined,
            'aria-hidden': true,
          }),
          h('span', null,
            stream.status === 'streaming' ? t('streaming')
              : stream.status === 'error' ? `${t('streamError')}${stream.message ? `: ${stream.message}` : ''}`
                : t('streamDone')),
          stream.status === 'error'
            ? h('button', {
              type: 'button', className: 'iui-btn iui-btn-ghost',
              onClick: () => { setStream({ status: 'streaming', message: null }); startStream() },
            }, t('retry'))
            : h('button', {
              type: 'button', className: 'iui-btn iui-btn-ghost',
              onClick: startStream,
            }, t('replay'))) : null)
    }

    /**
     * The reserved real-LLM source: an SSE stream of the same event objects
     * `StreamPlayer` consumes. Not connected by design — no backend ships with
     * the plugin — so it reports that instead of pretending to stream.
     * @param url - the SSE endpoint, once a backend exists.
     * @returns an object whose `connect` explains what is missing.
     */
    function createSseSource(url) {
      return {
        url,
        connect() {
          return Promise.reject(new Error('SSE source is not connected: configure a backend endpoint to stream real LLM events'))
        },
      }
    }

    /**
     * The Schema Playground: edit a JSON UI Schema in place, see the
     * validation result, and preview the rendered UI live.
     */
    const PLAYGROUND_SAMPLE = JSON.stringify({
      state: { budget: 8000, people: 2 },
      compute: { per: 'budget / people' },
      tree: {
        id: 'root', type: 'column',
        children: [
          { id: 'k', type: 'kpi', props: { label: 'Per person' }, bind: { value: 'per' } },
          {
            id: 's', type: 'slider', props: { label: 'People', min: 1, max: 8, step: 1 },
            bind: { value: 'people' },
            on: { change: { action: 'set', path: 'people' } },
          },
          {
            id: 'b', type: 'button', props: { label: '+1000 budget', variant: 'primary' },
            on: { click: { action: 'set', path: 'budget', expr: 'budget + 1000' } },
          },
        ],
      },
    }, null, 2)

    function PlaygroundView({ spec, colors, t }) {
      const [engine, setEngine] = useState(null)
      const [text, setText] = useState(() => (
        typeof spec.source === 'string' ? spec.source
          : spec.source ? JSON.stringify(spec.source, null, 2)
            : PLAYGROUND_SAMPLE))
      const [result, setResult] = useState({ ok: false, errors: [], app: null })
      const [revision, setRevision] = useState(0)

      useEffect(() => {
        let alive = true
        loadEngine().then((mod) => { if (alive) setEngine(mod) })
          .catch((error) => { if (alive) setResult({ ok: false, errors: [String((error && error.message) || error)], app: null }) })
        return () => { alive = false }
      }, [])

      const validate = useCallback((source) => {
        if (engine === null) return
        try {
          const parsed = JSON.parse(source)
          const app = engine.validateApp({ ...parsed, kind: 'app' })
          setResult({ ok: true, errors: [], app })
          setRevision((value) => value + 1)
        } catch (error) {
          setResult({ ok: false, errors: [String((error && error.message) || error)], app: null })
        }
      }, [engine])

      useEffect(() => {
        if (engine !== null) validate(text)
        // Validate once when the engine lands; later edits go through Apply.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [engine])

      return h('div', { className: 'iui-playground' },
        h('div', { className: 'iui-help' }, t('playgroundHint')),
        h('textarea', {
          className: 'iui-editor',
          value: text,
          spellCheck: false,
          'aria-label': t('playgroundTitle'),
          onChange: (event) => setText(event.target.value),
        }),
        h('div', { className: 'iui-row' },
          h('button', { type: 'button', className: 'iui-btn iui-btn-primary', onClick: () => validate(text) }, t('apply')),
          h('button', {
            type: 'button', className: 'iui-btn iui-btn-ghost',
            onClick: () => {
              const write = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
                ? navigator.clipboard.writeText(text)
                : Promise.reject(new Error('Clipboard API unavailable'))
              write.then(() => null).catch(() => null)
            },
          }, t('copy')),
          h('button', {
            type: 'button', className: 'iui-btn iui-btn-ghost',
            onClick: () => { setText(PLAYGROUND_SAMPLE); validate(PLAYGROUND_SAMPLE) },
          }, t('reset'))),
        h('div', {
          className: 'iui-validate',
          'data-ok': String(result.ok),
          role: 'status',
        }, result.ok ? t('valid') : result.errors.map((error, index) => h('div', { key: index }, error))),
        result.app
          ? h('div', { style: { marginTop: 6 } }, h(AppSurface, {
            engine,
            spec: result.app,
            colors,
            t,
            key: revision,
          }))
          : null)
    }

    /** Load the engine, then render one `app` spec through it. */
    function AppView({ spec, colors, t }) {
      const [engine, setEngine] = useState(null)
      const [error, setError] = useState(null)
      useEffect(() => {
        let alive = true
        loadEngine()
          .then((mod) => { if (alive) setEngine(mod) })
          .catch((caught) => { if (alive) setError(String((caught && caught.message) || caught)) })
        return () => { alive = false }
      }, [])
      if (error !== null) return h('div', { className: 'iui-node-error', role: 'alert' }, error)
      if (engine === null) return h('div', { className: 'iui-empty' }, t('preparing'))
      return h(AppSurface, { engine, spec, colors, t })
    }

    /**
     * Render one `ui_render` call.
     * @param props - keyed Tool slot props: `block`, the locale lookup, and the theme store.
     * @returns the interactive card, or a fallback while arguments are incomplete.
     */
    function IntelligentUiView({ block, t, theme }) {
      // The slot's `locale` option supplies `t`; falling back keeps a missing
      // dictionary from throwing, which would blank the whole slot entry.
      const tr = useCallback((key) => (typeof t === 'function' ? t(key) : DICTS.en[key]), [t])
      const colors = useTheme(theme)

      const spec = readSpec(block)
      if (spec === null) {
        return h('div', { className: 'iui-card' }, h('div', { className: 'iui-empty' }, tr('preparing')))
      }
      let body
      switch (spec.kind) {
        case 'compare': body = h(Compare, { spec, t: tr }); break
        case 'chart': body = h(Chart, { spec, colors, t: tr }); break
        case 'stats': body = h(Stats, { spec, colors }); break
        case 'progress': body = h(Progress, { spec, colors, t: tr }); break
        case 'steps': body = h(Steps, { spec }); break
        case 'table': body = h(Table, { spec, t: tr }); break
        case 'diagram': body = h(Diagram, { spec, colors, t: tr }); break
        case 'calculator': body = h(Calculator, { spec, t: tr }); break
        case 'unit': body = h(Unit, { spec, t: tr }); break
        case 'note': body = h(Note, { spec }); break
        case 'app': body = h(AppView, { spec, colors, t: tr }); break
        case 'playground': body = h(PlaygroundView, { spec, colors, t: tr }); break
        default: body = h('div', { className: 'iui-empty' }, `${tr('unsupported')}: ${spec.kind}`)
      }
      return h(Frame, { spec, colors }, body)
    }

    /**
     * Subscribe to the theme store so a light/dark switch re-resolves colors.
     * @param theme - the store supplied through the slot's `inject`.
     * @returns the current color snapshot.
     */
    function useTheme(theme) {
      const [colors, setColors] = useState(() => (theme ? theme.getSnapshot() : readColors()))
      useEffect(() => {
        if (!theme) return undefined
        setColors(theme.getSnapshot())
        return theme.subscribe(() => setColors(theme.getSnapshot()))
      }, [theme])
      return colors
    }

    return {
      name: 'intelligent-ui',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'intelligent-ui: dictionaries')

        // Charts read concrete colors out of the theme, so a scheme switch has to
        // invalidate them; the snapshot identity changes only when it really did.
        let snapshot = null
        const listeners = new Set()
        const theme = {
          getSnapshot() {
            if (snapshot === null) snapshot = readColors()
            return snapshot
          },
          subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        }
        ctx.effect(() => ctx.on('theme/change', () => {
          snapshot = null
          for (const listener of listeners) listener()
        }), 'intelligent-ui: theme invalidation')

        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'ui_render',
          locale: NS,
          inject: () => ({ theme }),
        }, IntelligentUiView)), 'intelligent-ui: tool view')

        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const marker = `${PKG}/intelligent-ui.css`
          if (document.querySelector(`style[data-plugin-css=${JSON.stringify(marker)}]`) !== null) return () => {}
          const tag = document.createElement('style')
          tag.dataset.plugin = PKG
          tag.dataset.pluginCss = marker
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'intelligent-ui: styles')

        // The Host compiles `tone` into Mermaid classes that reference these
        // custom properties; publishing them keeps tone resolution on the theme
        // (and therefore correct in both schemes) rather than in the spec.
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const marker = `${PKG}/intelligent-ui-tones`
          if (document.querySelector(`style[data-plugin-css=${JSON.stringify(marker)}]`) !== null) return () => {}
          const rules = Object.entries(TONE_TOKEN)
            .map(([tone, token]) => `:root{--iui-tone-${tone}:var(${token})}`)
            .join('')
          const tag = document.createElement('style')
          tag.dataset.plugin = PKG
          tag.dataset.pluginCss = marker
          tag.textContent = rules
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'intelligent-ui: tone tokens')
      },
    }
  },
})
