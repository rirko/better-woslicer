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

## R1a — app shell 可读性整理：**完成（2026-11-11，`fe90ca3`）**

- owner：协调者委派执行者起草、协调者验证提交。输入：T1 后 HEAD `1ffc81c`。可写集恰为卡内五文件（App.vue、styles.css、EditorToolbar.vue、DocumentOptions.vue、WorkspacePanels.vue）。
- 实际改动：逗号连声明拆为逐条（App.vue 四个 ref、DocumentOptions 四个 option 投影）；script/template/CSS 增加区域注释；CSS 以空行+注释分组，声明顺序未动；无 DOM/属性/事件/选择器/值变化、无改名/提取。
- 验证：`fmt:check` exit 0（formatter 稳定）；`lint` 恰好 301 problems 不变；`typecheck` 通过；app-controls + app-root 组件测试 2 files / 9 passed。视觉对照合并到 R1 全部完成后统一做。
- 备注：执行子进程在验证长命令阶段无输出超时中止，其文件改动完整且合规，由协调者接手完成验证；无白名单外改动。

## R1b — 面板与对话框可读性整理：**完成（2026-11-11，`31a7162`）**

- owner：协调者委派执行者、协调者独立复核提交。输入：`2f2e824`。可写集恰为卡内八文件（ApplicationMenu/PreferencesControls/SourceInfo/StatusBar/AboutDialog/MarkerList/DetectionPanel/OutputPanel）。
- 实际改动：+62 行全部为注释与 CSS 空行分组（协调者以"非注释/空行新增行为空"的过滤器独立复核）；无逗号连声明可拆（T1 后已是一条一行）；MarkerList 的嵌套三元与裸 192、OutputPanel 的本地 setter 判定一字未动（R8/R6 领域，只加描述注释）。
- 验证（协调者重跑）：fmt:check exit 0；lint 恰好 301；typecheck 通过；editor-panels + preferences + app-controls 3 files / 17 passed。
- 视觉对照合并到 R1 全部完成后统一做。

## R1c — 播放/时间轴/校准可读性整理：**完成（2026-11-11，`723f584`）**

- owner：协调者委派执行者、协调者独立复核提交。输入：`31a7162`。可写集恰为卡内三文件（PlaybackControls/TimelineEditor/CalibrationDialog）。
- 实际改动：+94/−4；唯一语义面变化是 `let frame/fullDraw/activePointer` 逗号连声明拆三条（协调者过滤器复核）；TimelineEditor 按 render/gestures/生命周期分层注释（H-4：不搬家、不分模块）；PlaybackControls 滑杆草稿协议与 CalibrationDialog 会话/令牌清理路径按现状注释，未改代码。
- 验证（协调者重跑）：fmt:check exit 0（执行者一处手工 CSS 空行被 oxfmt 改写后已按 formatter 为准收敛）；lint 恰好 301；typecheck 通过；timeline-render + timeline-gestures + timeline-playback + calibration + calibration-audio 5 files / 47 passed。
- 执行者如实报告起点工作树含协调者未提交的 R1b 进度记录（归属明确、未触碰）；视觉对照合并到 R1 完成后统一做。

## R1d — BMHelper 可读性整理：**完成（2026-11-11，`d80c9e9`）**

- owner：协调者委派执行者、协调者独立复核提交。输入：`723f584`。可写集恰为两文件（BMHelperPanel/PianoRoll）。
- 实际改动：src 纯插入 +52 行（注释与 CSS 空行分组；协调者复核 0 删除）；R9 领域（480 换算/parseStart base-36/copy 三元链）与两 dialog 生命周期一字未动，仅加如实注释；oxfmt 折叠 `>{{ }}<` 保留（空白敏感稳定形式）。
- 验证（协调者重跑）：fmt:check exit 0；lint 恰好 301；bmhelper-panel + bmhelper 组件测试 2 files / 5 passed（typecheck 在 R1 合并验证统一跑）。

## R1a–R1d 合并验证：**完成（2026-11-11，协调者）**

- 行为链全部复验：typecheck 通过；组件 18 files / **202 passed**；`build:app` 通过；`test:app-ui` 双 profile 2/2；lint 恰好 301（R1 期间每卡均复核不变）。
- 视觉对照（对照 post-T1 归档 `test-artifacts/ui-baseline-pre-r1/`）：重采 22 产物，10 个逐字节相同（全部对话框 + computed-styles.json 两份）；12 个含 canvas/工具栏的场景经逐像素定量全部为亚 perceptual 抖动（≤0.33% 像素、maxDelta ≤164 的单设备像素刻度线/抗锯齿位移；low/main 的 1717px 差异计数与 T1 对照时完全一致，属运行间确定性 AA 模式差，与 R1 编辑无关）。
- 基线轮换：`test-artifacts/ui-baseline/` 现为 **post-R1** 基线；post-T1 归档保留在 `ui-baseline-pre-r1/`。
- 结论：R1a–R1d 达到卡验收（读模板能按导航表识别区域；diff 只有注释、声明拆分与 CSS 分组；formatter 再运行无变化）。H-1/H-2/H-3 的"展开"部分已处置；其中牵涉语义分组的 F-7/F-8/F-9/F-10/F-39/F-44 仍由 R2–R9 处置，不因 R1 完成而改变状态。

## R2 — 去掉标签容器的虚假 host 依赖（F-9）：**完成（2026-11-11，`466fdfd`）**

- owner：协调者本地执行。可写集恰为卡内三文件（App.vue / WorkspacePanels.vue / app-controls.test.ts）。
- 实际改动：删除 WorkspacePanels 的 `Platform` type import 与 `defineProps`（无其他 prop，整体删除）；App 模板删除 `:platform` 绑定（`:key="panelGeneration"`、activeTab、v-if、workspace/BMHelper 注入原样；App 真实 platform 仍用于 createCommands 与 syncAppearance）；测试删除仅为该 prop 构造的假 Platform 与 props 传入、移除随之无用的 type import。
- 验收（协调者重跑）：lint 0 / fmt:check 0 / typecheck 0 / app-controls + app-root 2 files / 9 passed（BMHelper 跨 tab 用例保持原时机卸载/重建断言）。无需为删 prop 新建测试（按卡验收条款）。
- finding 状态：F-9 **resolved**（其余 finding 状态仍按 §6 队列，不因本卡变动）。

## R3–R10：pending（见方案第 3/4 节；R4/R6/R7 与 T2 已改文件的重叠已在各自卡面标注）

- 前置：R0（已完成）＋ T0（已完成）＋ T1 格式基线（已完成，2026-11-11）。
- 下一卡：**R1a–R1d**（按区域审查 T1 格式化输出、做少量语义分组整理；文件集合见方案 §4）——之后 T2 lint 清理（清单 `test-artifacts/lint-baseline/eslint-baseline.json`，301 条）与 R2–R10。
