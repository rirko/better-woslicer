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

## R3 — 布局规则与所属画面放在一起（H-2）：**完成（2026-11-11，`39577e6`）**

- owner：协调者先确认级联并批准方案（含采集基础设施补强），flash 执行者搬移（`agent_d1714ef1`），协调者逐字节复核与全量验证提交。输入基线：`4b5a004`。可写集恰为两文件（`src/app/styles.css`、`src/app/App.vue`）。
- 协调者级联确认（搬移前对 debug 构建产物 `grep -bo` 字节偏移实测，存 `test-artifacts/r3-css-order-before.txt`）：①子组件 scoped CSS（TimelineEditor 568、WorkspacePanels 7129）在 final bundle 中先于 styles.css 内联规则（374984+）；②`.workspace > .side-panel`(@680, 特异性 0,2,0) 靠源顺序压过 WorkspacePanels scoped `.side-panel[data-v]`（同 0,2,0），680px computed（minHeight 250px/borderLeft 0/borderTop 1px）实证生效中；③`.timeline` 全局 180px 与 scoped 160px：scoped 靠特异性 (0,2,0)>(0,1,0) 恒胜（与顺序无关），全局只实际贡献 `flex: 1`——两条声明按卡面禁令一字未动。
- 搬移方案（协调者批准）：styles.css 只留 reset/`html,body,#app`/字体四组；App 布局规则（`.app-shell`/`.workspace`/`.editor-column`/`.playback-strip`/`.timeline`/`.drop-overlay`/两个 media 块）搬到 App.vue 现有非 scoped style 块的 @import 之后，保持选择器/声明/顺序逐字；`.workspace > .side-panel` 保留在 App（retained-with-reason：它是 `.workspace` 容器拥有者的窄屏合同，移入 WorkspacePanels scoped 会改变同特异性级联胜出方，等价性需新增证据而可读性无增益；后续如要做为独立 diff 由协调者另批级联方案）。
- 实际改动：styles.css 93→21 行；App.vue style 块 @import 后追加 72 行搬移块 + 明确标注注释（非 scoped 理由与级联等价性）。协调者机械复核：`git show HEAD:src/app/styles.css` 搬移块与 App.vue 新增块 **72 行逐字节一致**；script/template/import 零改动；无白名单外文件。
- 验证：fmt 0 / lint 0 / typecheck 0 / 组件 18 files **202 passed** / `build:app` 通过；CSS 顺序 after 对照（`test-artifacts/r3-css-order-after.txt`）：子组件 scoped 位置逐字节不变，App 规则仍在其后且相对顺序不变；**computed styles 6/6 逐字节一致**（main/narrow-900/narrow-680 × low/high，含 900px 固定 310px 列与 680px flex column 堆叠）；截图对照（对照归档 `test-artifacts/ui-baseline-pre-r3/`）：dark 主题 narrow-680 两 profile **逐字节一致**（light/dark 核对完成），其余 8 对逐字节同、差异对全部为既证运行间 AA/波形画布抖动（≤0.62%，热点在工具栏文字 AA/标尺刻度，非布局边缘）；`test:app-ui` 双 profile 2/2。
- 本卡发现并修复 R0 采集缺陷（`65c6f8a`）：`awaitDarkApplied` 只等 `html.dark` class 落地即截图，Element Plus 组件色值 transition（~0.3s）未收敛，dark 截图会落在中途帧（首采 low 7.07% 差异、high 0.08%，经查基准图 ElSegmented indicator 还停在 Light）。修复为 `awaitTransitionsSettled`（poll `document.getAnimations()` running===0）；修后以搬移前代码+修复后 spec 重采基准再对照，dark 两 profile 逐字节一致。教训同 T2：对照基准本身有缺陷时，先修基准再对比，不用中途帧下结论。
- 基线补强（`4b5a004`）：ui-readability spec 增 narrow 900/narrow 680 场景（含 dark 截图与 computed JSON，布局 JSON 增加 flexDirection），runner 支持 `--grep=<substring>` 场景过滤；归档模式不变（post-R1 基线 + pre-move 窄屏证据整体归档在 `ui-baseline-pre-r3/`）。
- finding 状态：H-2 **resolved**（布局规则归位；`.workspace > .side-panel` 的归属保留为有理由的 open option，不阻塞）。

## R4 — 合并 boolean 确认协议（F-7，部分处置）：**完成（2026-11-11，`097a945`+`e538e36`）**

- owner：协调者先写行为基线（`097a945`：app-root 新增 10 用例钉住现状——clean 直开、接受+锁释放、cancel、close、异常上抛 status、pending 重入拒绝（单 dialog）、卸载后迟到 resolve 不继续、reset pending 期重复 close 与 keydown 拦截、reset 失败锁释放+错误可见、close 取消保留工作区），flash 执行者提取（`agent_61dbf9f8`），协调者逐行审查提交（`e538e36`）。
- 实际改动：App.vue +38/−58，新增局部 `confirmAction({body,title,confirmButtonText,cancelButtonText})`（closing 重入检查→置锁→confirm→`!disposed`→cancel/close 过滤→report→finally 解锁，与原协议逐 token 一致）；四入口保留业务名改为一行委托，翻译键不变（relink 的 `difference`/legacy 的 `summary` 参数照传）；`confirmProjectReplacement` 的 `!editor.isDirty` 早返回保持在原位置；**`closeWorkspace` 一字未动**（卡面要求的有意保留：其锁必须覆盖确认→playback.stop→await reset→bmhelper.reset→panelGeneration++ 全链）。测试文件零改动（基线用例即等价性证据）。
- 协调者审查记录：①锁区间/异常过滤/`!disposed` 位置与原逐行一致；②已知的无害差异——重入被拒路径上四个 `t()` 在进 helper 前先行求值（原来早返回不调 t()）；t() 为纯翻译查找无可观察副作用，基线用例无此断言，接受并记录；③基线测试编写中发现并修了两个测试自身问题：默认文档 `noisegateEnabled: true` 使同值写入成为 no-op 事务（改翻转当前值置 dirty）、`editor.doc` 是只读投影而完整文档在 `editor.document`、bmhelper store 跨用例共享 pinia 的 name 清空时机依赖前序用例（reset 失败用例聚焦锁释放/错误可见，工作区清空断言由独立专用用例覆盖）。
- 验证（协调者重跑）：fmt 0 / lint 0 / typecheck 0 / 组件 18 files **212 passed**（含 10 个新基线用例）/ `build:app` 通过。模板与样式零改动，UI 视觉对照无需重采（渲染产物不变）。
- finding 状态：F-7 **partial**（按卡面不标"五份全部消除"——closeWorkspace 的相似锁序列有意保留；后续若统一需另定"确认加执行"的完整锁合同）。

## R5 — 滑杆草稿协议只定义一次（F-39）：**完成（2026-11-11，`2bf2d0b`+`049a42e`）**

- owner：协调者先补两路验收基线（`2bf2d0b`：timeline-render 新增 2 用例——主/cue 各自多次 update + 一次 stale change 提交、number[] 载荷忽略、互不串值、一次有效提交恰好 +1 docRevision、undo 后 displayValue 回退 bound），flash 执行者提取（`agent_2f6e795b`），协调者审查后调整模板绑定并复验提交（`049a42e`）。
- 实际改动：新建 `src/playback/use-slider-draft.ts`（固定合同 `useSliderDraft(readValue, commitValue)` → `{draft, displayValue, onUpdate, commit}`；独立 `ref<number|null>`；onUpdate 仅 number 分支；commit 取 `draft ?? readValue()` 后清草稿再单次回调）；PlaybackControls 主/cue 两次独立实例化，dB/amp 转换留在组件，handler 名经解构保持模板原文（`volumeDisplay/onVolumeUpdate/commitVolume`、`cueDisplay/onCueVolumeUpdate/commitCueVolume`）。
- 执行者偏差与协调者修正：卡面模板文本 `volumeSlider.displayValue` 无法过 typecheck（嵌套 ComputedRef 不被模板自动解包，Element Plus prop 也拒绝 ComputedRef）；执行者临时用 `.value` 后缀通过，协调者改为解构顶层绑定（Vue 惯例、模板零 `.value`、handler 名与原模板一致），复验全绿。
- 验证（协调者重跑）：fmt 0 / lint 0 / typecheck 0 / 组件 18 files **214 passed** / `build:app` 通过。未重采 UI（模板语义与渲染不变）。
- finding 状态：F-39 **resolved**。

## R6 — 共享 fade/gate 的 UI 输入限制（F-8，部分处置）：**完成（2026-11-11，`3bae13e`）**

- owner：协调者本地执行（改动机械，R2 先例）。可写集恰为卡内三文件（DocumentOptions.vue / OutputPanel.vue / 新建 src/slicing/control-limits.ts）；两测试文件无需改动。
- 实际改动：新建 `control-limits.ts` 只导出 `FADE_INPUT_LIMITS`（min 0 / max 60000）与 `GATE_INPUT_LIMITS`（min -200 / max 0），`as const`；两面板模板四处 min/max 字面量改为具名常量引用，step/precision/controls/size/aria 全部不动；两处本地 setter 判定差异（DocumentOptions `typeof value === 'number'` vs OutputPanel `value !== undefined`）与 docRevision 依赖、gateEnabled 投影按卡面保留。
- 验证（协调者重跑）：fmt 0 / lint 0 / typecheck 0 / app-controls + editor-panels 2 files 10 passed / 全量组件 **214 passed**。
- finding 状态：F-8 **partial**（按卡面：UI 输入限制已共享；绑定/事务副作用差异有意保留，不扩展到 F-42 codec 校验）。

## R7 — 应用 BMHelper 切点归到 editor actions（F-10）：**完成（2026-11-12，`2114d4d`）**

- owner：协调者冻结契约后派发 flash（子代理在验证阶段被取消，但其文件改动已完整覆盖白名单五文件；协调者逐 diff 审查合规后接手修复一处测试基础设施并完成全部验证提交）。
- 实际改动：`createEditorActions` 新增 `applyBmhelperCuts(ticks: readonly number[]): void`（规则逐句移入：legalTick 过滤+Set 去重、dropped 按原输入非法项计数、无合法项只报 bmhNoDivision、一次 setTicks、清 tick+range 选区、bmhAppliedDropped/bmhApplied 反馈、保留当前 BPM；**入口无 cancelDraft**——保留原流程空输入/全拒绝不取消草稿的行为）；导出置于 removeSelected 之后。WorkspacePanels 删本地规则与 bpm computed，改 `useWorkspace().actions` 转发（`applyBmhelperCuts(payload)`，卡面要求注入而非直连 store）；BMHelperPanel 删 bpm prop/withDefaults，emit 契约改 `{ ticks: number[] }`。
- 测试：bmhelper-panel 删 props 断言改 `[[{ ticks: [0] }]]`；app-controls 的 bmhelper 用例 emit 载荷去掉 bpm、**核心断言全保留**（ticks [0,48]、BPM 120 不变、bmhAppliedDropped {count:2,dropped:4}、一次 undo 恢复 [24]、跨 tab store 保留）。协调者补修：该用例改用真实 workspace fixture 注入（`fixture()` + `provide: { [workspaceKey]: f.workspace }`）——WorkspacePanels 从直连 store 改注入后挂载需要 provider，这正是卡面"注入测试用真实 workspace fixture"的验收要求。
- 验证（协调者重跑）：fmt 0 / lint 0 / typecheck 0 / 全量组件 18 files **215 passed**。
- finding 状态：F-10 **resolved**（规则归属 editor actions；事件载荷收窄为 ticks）。

## R8 — 切点列表用直观分支表达（F-44）：**完成（2026-11-12，`35fd9bc`+`1d7bc04`）**

- owner：协调者本地执行。先补基线用例（`35fd9bc`：Ctrl 增选/Meta 移除、播放中 playhead 冻结/停止后跟随、小节边界 191→M1/192→M2），重构后全绿。
- 实际改动：MarkerList 的裸 192 改 `MEASURE_TICKS`（timebase 既有常量）；choose 的嵌套三元提取为 `nextSelection(tick, event)` 命名分支（普通替换/Ctrl或Meta 增/已选移除）；cursor→selection→scroll→非播放 playhead 顺序、rowHeight 32、虚拟化窗口/overscan、样式全部未动。
- 验证（协调者重跑）：fmt/lint/typecheck 0、全量组件 **215 passed**。
- finding 状态：F-44 **resolved**。

## R9 — BMHelper 表达与单位可读（F-11、H-3）：**完成（2026-11-12，`91e3ba6`+`c862070`）**

- owner：协调者本地执行。先补基线用例（`91e3ba6`，重构前提交）钉住现状——quantize 100（≠480）时设置换算与小数截断（headMargin 0.125 拍 ×100=12.5→trunc 12，recording 首音位置 12 直接可观察；minInterval 1 拍→100 tick，布局落 300 拒绝 480 基准换算）、定义编号 span 文本、三种 copy 载荷（cuts/bms/definitions 经 dialog footer）、取消后在 `closed` 才清 pending 的时机。
- 实际改动：resetSettings 的 5 处裸 480 收敛为 `DEFAULT_SETTINGS_TPQN` 常量（注释明示与 BMH 48/quarter、ZZ 0..1295 无关；create 仍用 `store.project.source.quantize`）；`selectedDefinitionNumbers` computed 提取定义编号 map（模板只剩 join 展示）；copy 三元链改按 kind 三分支（division/source 守卫对三种 kind 先行，顺序保持）；四个操作区加语义 class（`project-actions`/`division-actions`/`recording-actions`/`transpose-actions`，`.actions` 旧选择器与 DOM 不变）；settings draft、numericSettings、create 三处单位注释（拍数/次数/编号文本三分）。Math.trunc、校验顺序、dialog 开闭顺序、parseStart、文案、排序零改动。
- 测试基建教训：VTU auto-stub 不渲染 slot——`renderStubDefaultSlot` 只管 default slot；footer 按钮需自定义 stub 渲染 named slot；`@closed` 类生命周期事件经 stub 声明 emits + setup 捕获 emit 触发（模板中第一个 dialog 是设置对话框，emit 数组按序取 [0]）。`createPlatform()` 不可写 `: Platform` 返回注解（会拓宽 vi.fn Mock 为接口方法签名，触发 unbound-method）。
- 验证（协调者重跑）：fmt/lint/typecheck 0、定向 bmhelper-panel 4/4、全量组件 18 files **218 passed**。
- finding 状态：F-11 **resolved**；H-3 **resolved**（按区域命名已落地；两个 dialog 与共享 busy/error/pending 生命周期按卡面决定保留，不视为未完成项）。

## R10 — 集成与收尾：**完成（2026-11-12，协调者）**

- 集成链（第 5 节，全部串行重跑）：lint 0、fmt:check 0、typecheck 0、`npm test`（tooling + 组件 **218** + gen:i18n + tsc + core **180**/4 oracle 缺 fixture skipped）、`npm run build` 通过、`test:app-ui` 双 profile 各 1 passed（ui-readability 场景按设计门控 skip）、`verify-ui-readability.mjs` 全场景 **14/14**（7 场景 × low/high）对照通过。日志 `test-artifacts/r10-*.log`。
- 导航抽查（画面 → owner，无跨无关包装层）：fade 输入限制 → `src/slicing/control-limits.ts`（`FADE_INPUT_LIMITS`）；cue 重置 → `src/playback/cue.ts`（滑杆草稿经 `use-slider-draft.ts`）；BMH apply → `BMHelperPanel.vue` emit `applyCuts` → `WorkspacePanels.vue` 3 行类型化接线 → `editor-actions.ts` `applyBmhelperCuts`；波形色彩 → `src/timeline/waveform.ts` 显式 `colors: { outer, rms }` 参数。
- 反模式核对：未出现更少行但更多跳转、新的重复状态、大量无意义 forwarding、万能 props（BMH apply 的 WorkspacePanels 转发是 R7 卡面契约的事件→action 接线点，3 行带完整类型，与 app 其余 action 接法一致）。
- finding 回填终态（本轮全部 UI 系 ID）：F-9、F-10、F-11、F-39、F-44 **resolved**；F-7、F-8 **partial**（理由见 R4/R6 节）；H-1/H-2/H-3 **resolved**（H-3 的 dialog 生命周期共享按卡面决定保留）。其余 ID 按 UI_READABILITY_PLAN §6 队列维持 **deferred**，.smell-check 原报告保留为历史快照。
- 纯 refactor 确认：root version 1.0.0、README×4、changelog×2 均未改动。

- 前置：R0（已完成）＋ T0（已完成）＋ T1 格式基线（已完成）＋ R1a–R1d/R2/T2/T3/R3–R10（均已完成）。
- 界面等价重构（R0–R10）与 lint/fmt 方案（T0–T3）**全部完成**。
