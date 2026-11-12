# 界面可读性重构进度

配套方案：[UI_READABILITY_PLAN.md](UI_READABILITY_PLAN.md)；lint/fmt 工具进度见 [LINT_FORMAT_PROGRESS.md](LINT_FORMAT_PROGRESS.md)。每卡记录 status、owner、输入 commit、实际输出与测试证据；没有运行证据的卡不得从 pending 变为 verified。

## R0 — 建立可比较的基线：**完成（2026-11-11）**

- owner：协调者（本会话）。输入基线：`8e601e6`（T0 工具提交，产品源码与 `44a8192` 一致，无任何格式化改动）。
- 环境：Windows；**Node 24.22.2**（按方案从默认 node 26 经 npx 缓存 node24 显式切换）、npm 11.20.0；UI 为 Chromium 双 profile（low 1280×720/DPR1、high 1920×1080/DPR2），配置复用 `playwright.app.config.mts`。

### 命令与结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（gen:i18n + vue-tsc + tsc） |
| `npm run test:components` | 18 files / **202 passed** |
| `npm run build:app` | 通过（大 chunk warning 与历史一致） |
| `npm run test:app-ui` | low/high 各 1/1（project-workflow） |
| `node scripts/verify-ui-readability.mjs` | **10/10**（5 场景 × 2 profile；每次独立 Playwright 进程 + 独立静态服务器 + 外层 30 秒 watchdog + 进程树清理；实测单次 4.9–6.6s） |
| `eslint`（T0 基线） | 301 problems / 45 files，与本轮 T0 记录一致；新 R0 文件零违规 |

### 视觉与样式产物（gitignored `test-artifacts/ui-baseline/{low,high}/`）

- 截图：`main.png`、`tab-{source,cuts,detect,output,bmhelper}.png`、`bmh-settings-dialog.png`、`bmh-definitions-dialog.png`、`about-dialog.png`、`calibration-dialog.png`。
- computed style：`computed-styles.json`（每 profile 一份）。要点（low/high 一致处）：`.timeline` min-height **160px**（scoped 160 覆盖全局 180 生效中）、display flex、overflow hidden；`.workspace` 为 grid，low=896px/384px、high=1344px/576px；`.side-panel` border-left 1px、overflow auto；`horizontalOverflow` 0。这是 R3 级联搬移的对照证据。

### 本轮发现（影响后续卡，均已如实记录）

1. **web lane 无 About 身份信息**：web 变体 CSP `connect-src 'none'` 拦截 `/build-info.json` fetch（CDP/console 实证），identity 恒为 null：状态栏出现 "Load failed: Failed to fetch"（出现在基线截图中，属当前 web-lane 真实状态），About 对话框 body 为空（无版本/提交）。About 经 View 菜单打开（菜单分组触发器被 Element Plus 渲染为 `role=button`，下拉项才是 `menuitem`）。
2. **对话框截图等待**：Playwright `toBeVisible` 在 ElDialog 淡入 opacity=0 时即通过，截图会拍到空帧；spec 用 `expect.poll(computed opacity === '1')` 稳定（无固定 sleep）。Chromium `fullPage` 截图会丢失 fixed 定位的对话框遮罩，本应用恰好填满视口，故用默认视口截图。
3. **主题**：工具栏有 Auto/Light/Dark 切换（默认 Auto）；headless Chromium 解析为 Light，全部基线为 Light 主题。
4. BMH 两个对话框用合成 MIDI（`writeSmfSequence`，与组件测试同源）驱动：Import MIDI → New division 对话框；OK 创建后 → Definition info 对话框。
5. 基线 spec 默认被 `WOSLICER_UI_BASELINE` 门控跳过，`test:app-ui` 保持单测试/profile 的 30 秒预算；基线场景只经 `scripts/verify-ui-readability.mjs` 逐场景调用。

### 未运行 / 边界

- 本基线全部是**浏览器 lane 证据**；native Tauri 双 profile 仍是 W6 未完成项，Firefox、真实原生对话框不在本轮。
- 截图无自动 diff 断言（与既有 project-workflow 一致）；R 卡验收时由协调者做前后对照（必要时配 computed style）。

### 2026-11-11 补充：T1 格式基线后的基线轮换

T1（oxfmt 全量格式化，5 个格式专用提交）完成后已重采全部 22 个基线产物：`test-artifacts/ui-baseline/` 现为 **post-T1** 基线（R1a–R1d 的对照基准）；R0 当时的捕获归档在 `test-artifacts/ui-baseline-pre-t1/`。对照结论：10 个产物逐字节相同（含全部对话框与 computed-styles.json），12 个仅有亚 perceptual 像素抖动（≤0.28% 像素，文字抗锯齿/标尺刻度 1 设备像素位移，逐对 pixel-diff 定量见 [LINT_FORMAT_PROGRESS.md](LINT_FORMAT_PROGRESS.md) T1 节）。行为链（typecheck/202 组件/build/lint 计数 301 不变）在 T1 后全部复验通过。

## R1a–R1d / R2–R10：pending（见方案第 3/4 节）

- 前置：R0（已完成）＋ T0（已完成）＋ T1 格式基线（已完成，2026-11-11）。
- 下一卡：**R1a–R1d**（按区域审查 T1 格式化输出、做少量语义分组整理；文件集合见方案 §4）——之后 T2 lint 清理（清单 `test-artifacts/lint-baseline/eslint-baseline.json`，301 条）与 R2–R10。
