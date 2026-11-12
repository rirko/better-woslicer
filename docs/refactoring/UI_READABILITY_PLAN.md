# 界面可读性与等价重构执行方案

状态：**方案已编写，实施尚未开始**。核对日期：2026-11-11 JST。源码基准：`feature/tauri` / `44a8192`，编写前工作树干净。

目标：维护者从画面上的一个区域出发，能直接找到它的模板、外观规则、状态所有者和操作入口；用更容易理解的等价表达替换密集表达与重复协议。以理解成本和回归成本衡量收益，不以行数、文件数或 smell 清零为目标。

本轮只制定计划，没有改变产品代码、重新运行 smell-check、构建或执行应用测试，也没有现场验证渲染外观。下面的行为判断来自当前源码和测试阅读，不能作为运行通过的证据。

2026-11-11 追加：[lint / fmt / commit hook 方案](LINT_FORMAT_PLAN.md) 纳入本计划，状态待实施。选型为 Oxfmt、ESLint flat config + TypeScript/Vue 插件、Husky/lint-staged；先建立统一工具与格式基线，再做语义重构，提交时只检查不自动改写，CI 全量兜底。

## 1. 输入、证据与边界

- 仓库规则：[AGENTS.md](../../AGENTS.md)、[协作标准](../ENSEMBLE.md)、[迁移恢复入口](../migration/RESUME.md)、[实施计划](../migration/IMPLEMENTATION.md)。用户本次请求确定界面可读性规划的优先级；不因此宣布 W6 剩余事项完成。
- 当前审计：[summary.md](../../.smell-check/20261110-180802Z/summary.md)，基准同为 `44a8192`，**57 active / 5 dismissed**，profile 为 small。迁移历史提到的 `20261108-053416Z` / 63 active 不是本方案基准。
- 审计中 TS/JS 有机械指标，Vue/Rust 函数指标降级为 estimate；Vue 没有长度告警不能证明模板易读。semantic finding 是待判断的维护风险，不自动等于行为缺陷。
- `.smell-check/` 当前由本机 Git exclude 忽略，其他 checkout 可能没有报告。本文件保留关键证据、ID 和处置理由；需要追查原始指标时取得原报告，不凭本方案补造机器结果。
- 已应用 Vue / TypeScript best-practices：保持 Composition API、显式数据流、状态与清理同归属、严格类型、边界验证。采用“先保持行为可验证，再整理表达，最后按职责收敛”的顺序。
- 不改布局设计、文案、快捷键、可用性规则、数据格式、音频算法、应用运行时依赖或版本。T0–T3 可新增已约定的开发依赖、脚本、hook 与 CI 检查；不新增运行时网络能力。纯内部重构不写 README/changelog 的 UX 条目，工具开发命令可按仓库规则同步 README 开发小节。

### 当前源码核对

以下行号固定于上述基准，实施时用符号重新定位。

| 证据 | 当前事实 | 处理判断 |
|---|---|---|
| H-1（人工补充），`DocumentOptions.vue:23–28`、`OutputPanel.vue:19–28` | 多属性、标签、控件、事件与文案压在一行；大量 CSS 也是单行 | 先展开，保留控件的直接模板表达；无需新增表单框架 |
| H-2，`App.vue:139–153`、`styles.css:5–18` | 主模板已经按画面顺序组合；布局规则分布在全局 CSS 和子组件 scoped CSS | 保留现有主要区域，明确样式所有权；不要再包一层无责任组件 |
| H-3，`BMHelperPanel.vue:91–156` | 导入操作、分割操作、编号操作共用 `.actions`；两个 dialog 与面板混排 | 按区域展开与命名；当前先保留共享 busy/error/pending 的生命周期 |
| F-7，`App.vue:41–114` | 四个 boolean 确认流程重复；关闭工作区额外锁住异步 reset | **修正报告建议**：先只合并四个确认流程；不能让 close 在 reset 前解锁 |
| F-8，`DocumentOptions.vue:17,26–27`、`OutputPanel.vue:10–13,20–21` | fade/gate 的输入限制重复，但两个数字 setter 的输入过滤不同 | 先共享具名输入限制，保留本地 setter；不为消重改变事务/草稿副作用 |
| F-9，`WorkspacePanels.vue:12`、`App.vue:147` | `platform` prop 未被使用 | 删除这条虚假依赖，实际 host 仍经 workspace 注入 |
| F-10，`WorkspacePanels.vue:17–25` | 标签容器实现切点过滤、选区清空和反馈 | 规则归到既有 editor actions；先固定事件契约，再迁移 |
| F-39，`PlaybackControls.vue:16–35` | 主音量、cue 音量各维护一套 update 草稿 / change 提交 | 可共享协议；不能退回直接 v-model 或采用 change 的旧值 |
| F-44，`MarkerList.vue:35` | 小节计算使用裸 192，而 StatusBar 使用 MEASURE_TICKS | 局部替换为现有常量，并展开选择逻辑的嵌套三元式 |
| H-4，`TimelineEditor.vue:32–59,107–132` | 画布调度与手势代码密集，但已有 render / gestures / waveform 分层 | 本批只展开与命名；不把整段 script 搬到 useTimelineEditor |

## 2. 画面与代码的导航合同

这是现有结构的整理目标，不是新组件树。每个区域的模板顺序跟随画面；关联 script 分组、class 和 style 按同样顺序排列。主题文案、组件状态不搬进 CSS 配置表。

| 画面区域 | 模板入口 | 外观归属 | 行为 / 状态归属 |
|---|---|---|---|
| 整体窗口、左右分栏、拖放遮罩 | `src/app/App.vue` | App 的布局样式；全局 reset 留在 `src/app/styles.css` | App 装配 workspace/playback，拥有对话框开关与关闭协调 |
| 顶部业务菜单 | `src/app/components/ApplicationMenu.vue` | 同 SFC | `menu.ts` / `commands.ts`；不在模板重写规则 |
| 文件操作、撤销、校准、偏好 | `EditorToolbar.vue`、`PreferencesControls.vue` | 各自 SFC | 命令事件向 App；偏好来自现有 preferences store |
| BPM、栅格、吸附、偏移、fade/gate | `DocumentOptions.vue` | 同 SFC | 文档字段走 editor 事务；grid/snap 保持会话属性 |
| 播放、主音量、速度、cue | `src/playback/PlaybackControls.vue` | 同 SFC | playback 服务；两个滑杆各自拥有临时草稿 |
| 标尺、波形、选区/游标、总览、横向滚动 | `src/timeline/TimelineEditor.vue` | SFC 管布局；`render.ts` / `waveform.ts` 管绘制；`src/ui/palette.ts` 管 Canvas 色彩 | gestures 管手势，SFC 管 DOM/RAF/observer 生命周期 |
| 右侧标签切换 | `WorkspacePanels.vue` | 同 SFC；父布局仅决定占位、边界关系 | 本地 activeTab；panelGeneration 的重挂载由 App 持有 |
| 音源资料 / 失联媒体 | `SourceInfo.vue` | 同 SFC | workspace 的媒体事实与 relink |
| 切点列表 | `src/slicing/MarkerList.vue` | 同 SFC | 本地虚拟滚动；编辑调用 workspace.actions |
| 频段检测 | `src/detection/DetectionPanel.vue` | 同 SFC | workspace/detection；worker 不转移到标签组件 |
| 输出设置 / 导出按钮 | `src/export/OutputPanel.vue` | 同 SFC | 字段写 editor；导出交给 workspace |
| BMHelper 操作 / 分割设置 / 定义文本 | `src/bmhelper/BMHelperPanel.vue`、`PianoRoll.vue` | 各自 SFC | BMH store 持有文档；面板持有草稿和弹窗；应用切点归 editor actions |
| 状态栏 / About / 校准 | `StatusBar.vue`、`AboutDialog.vue`、`src/calibration/CalibrationDialog.vue` | 各自 SFC | 既有状态、构建元数据、校准生命周期 |

### 等价表达准则

1. 一条语句一行；多属性控件逐行写属性；标签和子控件按层级缩进；CSS 一条声明一行。保留短且清楚的表达式，不追求每个值都变成 computed。
2. 状态变化、早返回、异常处理展开成可逐步阅读的代码。嵌套条件优先具名变量或分支，不写成更长的链式表达式。
3. 使用业务名：`fadeoutMs`、`noisegateDb`、`selectedDefinitionNumbers`、`divisionActions`；避免仅为省字而起别名。保留已有有意义命名，不全仓改名。
4. 少量同形数据可继续 `v-for`，例如频段、速率、BMH numericSettings。不同控件/操作不得统一成万能字段表或按钮配置解释器。
5. 局部纯计算用普通函数；有独立状态协议才用小 composable。禁止 `useApp()` / `useBMHelperPanel()` 整块搬家及通用 `utils` 大杂烩。
6. 保持 `unknown` 边界、现有运行时校验与严格编译；不新增 `any`、`!`、未经验证的 `as`。不借重构引入新的 schema 库或 branded types 全仓迁移。
7. 以下不是死代码：`void editor.docRevision`、generation/revision 检查、dispose 防护、`v-if` 挂载条件、`panelGeneration`。没有专门证据不得删除或改为 v-show。
8. 逻辑等价包含：事件顺序、异常与取消、锁持有区间、事务次数、no-op/redo、异步过期结果、卸载清理、CSS 级联、DOM 空白与可访问名称。相同最终数值不足以证明等价。

## 3. 执行顺序与成本控制

先完成 R0 与 [T0 工具配置](LINT_FORMAT_PLAN.md)，再完成 T1 格式基线/R1 分组审查、T2 lint 清理、T3 hook/CI 上线，随后按依赖执行 R2–R10。所有卡初始为 `pending`。默认串行，每次只给 flash agent 一张卡及其相关文件。主协调者负责契约、跨卡冲突和最终验收；不要求 flash agent 重新分析全仓 57 项。

| 卡 | 任务 | 依赖 | 执行 / 审查 |
|---|---|---|---|
| R0 | 固定基线与验证资源 | 无 | 协调者 |
| R1a–R1d | 按区域审查自动格式化结果，再整理语义分组 | R0、T0；与 T1 协调 | flash；四次独立交付 |
| R2 | 删除无用 platform prop | R1a | flash |
| R3 | 归位布局样式 | R1a、R1c | 协调者先确认级联，再交 flash 搬移 |
| R4 | 合并四个确认协议 | R1a、R2 | flash；协调者重点审查锁与异常 |
| R5 | 共享双滑杆提交协议 | R1c | flash |
| R6 | 共享 fade/gate UI 输入限制 | R1a、R1b | flash |
| R7 | BMHelper 切点规则归属与事件收窄 | R1a、R1d、R2 | 协调者冻结下述契约，flash 实施 |
| R8 | 切点列表表达整理 | R1b | flash |
| R9 | BMHelper 单位与表达命名 | R1d、R7 | flash |
| R10 | 集成、视觉对照、finding 回填 | 所有已选卡 | 协调者 |

R1a/b/c/d 的文件不重叠，可以委派；默认不并行跑测试。R2/R4/R6/R7 共用 `app-controls.test.ts` 等文件时必须串行。R9 必须等 R7 交接，不允许两个 writer 同改 BMHelperPanel。所有构建、全量测试、UI profile 使用共享输出，统一串行。

成本约束：普通卡不超过 3 个生产文件，附必要行为测试；R1 格式化卡允许表中明确的固定文件集合。超出范围、需要改 owner/共享契约或失败原因相同且无新证据时，交协调者诊断，不扩大成“顺手清理”。格式展开和语义重构分开提交。没有依据不估算 token 或承诺速度倍数。

## 4. 可直接派发的任务卡

每卡的“可写”是白名单；其他源码、配置、lockfile、生成物均只读。工具配置/lockfile/hook/CI 的修改仅属 T0–T3 owner。文档进度与 Git index 由协调者统一维护。所有卡复用第 5 节验证规则。

### R0 — 建立可比较的基线

- 可写：`docs/refactoring/UI_READABILITY_PROGRESS.md`（新建），必要的 `tests/app/ui-readability.spec.ts`、`scripts/verify-ui-readability.mjs`（新建）；测试产物放 gitignored `test-artifacts/`，不改已有产品源码。runner 由协调者负责，不分给界面格式化执行者。
- 先核对 Git/Node/npm。规划现场为 Node **v26.12.1** / npm **11.20.0**；执行测试前切到 **Node 24**，记录实际版本。需要清洁安装用 `npm ci`；不把审计时 Node 26 的结果作为本轮基线。
- 运行 typecheck、现有 tests、生产 web build、现有 UI 双 profile，记录命令/结果/跳过项。失败先诊断，不开始依赖该失败检查的重构。
- 为视觉对照保存相同 fixture、locale、主题、窗口/DPR、页签、弹窗状态的前图。至少覆盖主界面、五个侧栏 tab、BMH 两个 dialog、About、校准。动布局的卡还覆盖 900/680px 两侧和长文案。
- 可新增 UI 用例只用于这些已有行为和视觉证据，复用当前配置；不在同一个 30 秒用例里塞所有状态，不用固定 sleep。每个“视觉场景 × profile”独立运行：runner 启动 `npm run test:app-ui -- --project=<low或high> --grep <唯一场景名>`，从启动起设置外层 30 秒 watchdog，结束/失败/超时均清理本次进程树和临时用户数据，再启动下一项。构建在计时前完成。
- 当前 Playwright 的 `timeout: 30_000` 仅限制单个 test，现有命令一次运行两 project，不能当作上述外层硬超时的证据。若 runner 未落实，则记录验证基础设施缺口，不宣称独立 profile 硬超时已满足；不要临时放宽超时掩盖失败。
- 记录当前 computed style：`.timeline` 的 min-height、`.workspace` 的布局/列宽、`.side-panel` 的边框、overflow、关键区域的 bounding box。为 R3 的级联搬移提供证据。
- 验收：进度文件有 baseline commit、环境、通过/失败/未运行列表、截图路径、owner 和下一卡。本方案当前没有这些运行证据。

### R1a–R1d — 先使现有界面源码可直接阅读

精确可写集合：

| 子卡 | 文件 |
|---|---|
| R1a | `src/app/App.vue`、`src/app/styles.css`、`src/app/components/EditorToolbar.vue`、`DocumentOptions.vue`、`WorkspacePanels.vue`（后两者同 components 目录） |
| R1b | `src/app/components/ApplicationMenu.vue`、`PreferencesControls.vue`、`SourceInfo.vue`、`StatusBar.vue`、`AboutDialog.vue`（同 components 目录）；`src/slicing/MarkerList.vue`、`src/detection/DetectionPanel.vue`、`src/export/OutputPanel.vue` |
| R1c | `src/playback/PlaybackControls.vue`、`src/timeline/TimelineEditor.vue`、`src/calibration/CalibrationDialog.vue` |
| R1d | `src/bmhelper/BMHelperPanel.vue`、`src/bmhelper/PianoRoll.vue` |

- 仅展开多语句、模板与 CSS；可加简短的区域注释。保持 import/执行顺序、DOM、属性、事件、选择器、CSS 声明顺序和值，暂不提取函数或更名。
- 使用 T0 定稿的 Oxfmt；R1 agent 不安装或调整工具，只操作本卡文件。全仓格式基线由 T1 分批安排；不改 tag 大小写/Element Plus 注册方式，模板空白可能影响 inline 文案，需对照输出。
- 验收：读模板能按导航表识别区域；diff 只有排版和必要注释，formatter 再运行无变化。执行 lint/fmt:check、typecheck 与对应现有组件测试；不新写镜像格式器的测试。R1 全部完成后合并做一次生产 UI 对照。

### R2 — 去掉标签容器的虚假 host 依赖（F-9）

- 可写：`src/app/App.vue`、`src/app/components/WorkspacePanels.vue`、`tests/components/app-controls.test.ts`。
- 删除 WorkspacePanels 的 Platform import、prop 声明及 App 的 `:platform`；清掉测试仅为该 prop 构造的假 Platform。若仍有用途则保留相应 import/fixture。
- 不动 App 的真实 platform、workspace provider、BMHelper 的注入，也不动 `activeTab`、`v-if`、`:key="panelGeneration"`。
- 验收：app-controls / app-root 通过；标签页切换仍按原时机卸载/重建。无需为删 prop 新建测试。

### R3 — 布局规则与所属画面放在一起（H-2）

- 可写：`src/app/styles.css`、`src/app/App.vue`；若移交窄屏侧栏边框，再开放 `src/app/components/WorkspacePanels.vue`，最多三文件。
- 全局文件只留 reset、html/body/#app、字体等全局规则；App 的窗口/分栏/遮罩规则放回 App。**第一步允许 App 中使用明确标注的非 scoped 布局 style**，保持选择器、声明顺序和导入先后；不把 scoped 当成必须同时完成的指标。
- 当前全局 `.timeline` 的 180px 与 TimelineEditor scoped 的 160px 有级联关系；`.workspace > .side-panel` 跨父子。先比较 R0 的有效样式，不能以“重复”删掉其中一条，也不能默认改为 scoped 等价。
- 若要改为区域专用类或 scoped，作为同卡的后续独立 diff，由协调者批准具体级联方案；无法证明等价则保留局部非 scoped 样式并记录理由，不引入更多 `!important` / `:deep()`。
- 验收：前后 computed style、布局 box 和同状态截图一致；light/dark、低/高 profile、900/680px 两侧均核对。不得同时改 CSS 数值美化界面。

### R4 — 合并 boolean 确认协议（F-7，部分处置）

- 可写：`src/app/App.vue`、`tests/components/app-root.test.ts`。
- 在 App 内建立局部 `confirmAction`，接收已翻译的 body/title/confirmButtonText/cancelButtonText，返回 `Promise<boolean>`；维持 closing 重入检查、置锁、confirm、`!disposed`、cancel/close 过滤、report、finally 解锁。不要新建 modal 服务。
- 四个有业务名称的入口保留；`confirmProjectReplacement` 的 `!editor.isDirty` 早返回保持在原位置；relink/legacy 的翻译 payload 不丢失，取消/异常路径不执行后续操作。
- **closeWorkspace 不接入此 helper**：它的锁必须覆盖确认、playback.stop、await workspace.reset、bmhelper.reset、panelGeneration++。留下这处相似代码，记录为有意保留；后续若要完全统一，另定“确认加执行”的完整锁合同。
- 先补行为缺口再实施：确认接受/取消/close/异常；确认 pending 时拒绝重入；卸载后迟到 resolve 不继续；reset pending 时重复关闭和快捷键仍被拦截；reset 拒绝后锁释放且错误可见。
- 验收：app-root 全部通过，实际断言后续副作用与锁期间输入，不只断言调用 helper。F-7 不能标成“五份全部消除”。

### R5 — 滑杆草稿协议只定义一次（F-39）

- 可写：`src/playback/PlaybackControls.vue`、新建 `src/playback/use-slider-draft.ts`（若局部函数已足够则不新建）、`tests/components/timeline-render.test.ts`。
- 固定合同：输入是 `readValue: () => number` 与 `commitValue: (value: number) => void`；返回 displayValue、onUpdate、commit。每次调用创建独立 `ref<number | null>`；onUpdate 仅接受 number 分支；commit 先取 `draft ?? readValue()`、清草稿，再调用 commitValue。change 载荷被忽略。
- 单位转换仍在 PlaybackControls：helper 只管理 slider position，不知道 dB/amp、editor 或 Pinia。主/cue 分别实例化，不合成数组或用索引路由。
- 不新增拖动取消、切项目自动清草稿等行为；若发现现有缺陷另立 fix 卡，不偷偷改变本卡基线。
- 验收：两路都覆盖 `update(50) → change(旧值)`、多次 update 后一次 commit、无 update 的 change、忽略 number[]、互不串值、外部 undo 后显示更新；每次有效提交只产生一次文档事务。保留真实 Element Plus 组件测试。

### R6 — 共享 fade/gate 的 UI 输入限制（F-8，部分处置）

- 可写：`src/app/components/DocumentOptions.vue`、`src/export/OutputPanel.vue`、新建 `src/slicing/control-limits.ts`；测试 `tests/components/app-controls.test.ts`、`editor-panels.test.ts`。
- 新模块只导出 `FADE_INPUT_LIMITS`（min=0、max=60000）和 `GATE_INPUT_LIMITS`（min=-200、max=0）；两处模板直接引用具名 min/max。它是 UI 输入限制的归属，不是所有 codec 的校验入口，不导入 Vue/store，不成为万能常量文件。
- **保留本地 computed/setter**：DocumentOptions 用 `typeof value === 'number'`，OutputPanel 用 `value !== undefined`。伪造非数字事件在后者可能走 `transact → cancelDraft`，即使最终数值不变；完全合并会改变副作用。也保留 docRevision 依赖和简短 gateEnabled 投影，不为少量一行重复引入带策略参数的绑定框架。
- 不改 step/precision/controls/size，不删除底层校验，不扩展到 F-42。后续若要统一非法输入行为，应另立有明确行为目标的 fix 卡；本轮不执行。
- 验收：现有字段验证、同步与 undo 测试继续通过；两个入口 min/max 与基线一致。没有新增协议，不要求新建镜像实现的测试。F-8 标 partial，记录绑定重复的保留理由。

### R7 — 应用 BMHelper 切点归到 editor actions（F-10）

- 可写：`src/slicing/editor-actions.ts`、`src/app/components/WorkspacePanels.vue`、`src/bmhelper/BMHelperPanel.vue`；测试 `tests/components/app-controls.test.ts`、`bmhelper-panel.test.ts`。共享 action 契约由协调者审查后再开始写。
- 固定 action：在既有 `createEditorActions(editor)` 中新增 `applyBmhelperCuts(ticks: readonly number[]): void`。规则逐句移入，不改执行顺序；WorkspacePanels 通过既有 useWorkspace().actions 调用，不自行 new workspace/store。
- 固定事件：BMHelperPanel 继续 emit `applyCuts`，参数改为 `{ ticks: number[] }`；删除仅为该事件存在的 bpm prop/default/父级 computed/传参。不把编辑器事务塞进 BMHelper store。
- 不变量：只接受 legalTick；合法重复值去重；dropped 按**原输入非法项数量**统计，重复合法项不算 dropped；没有合法项只报告 bmhNoDivision；有合法项调用一次 setTicks，然后清选区并按原语义反馈；保留当前 BPM，no-op/只读失败继承原 editor 行为。不得仿照其他 action 在入口新增 cancelDraft：原流程空输入/全拒绝时不会取消已有草稿。
- 现有测试明确断言 bpm 事件载荷，需更新为新内部契约，同时保留更重要的“实际应用不改 BPM / 一次 undo 恢复”断言，不能只删除失败断言。
- 验收：非法/重复/全拒绝/空输入/无音源/源尾边界、选区清空、BPM 不变、事务与 undo；panel 切换保留 BMH store。注入测试用真实 workspace fixture，不用断言伪造依赖。

### R8 — 切点列表用直观分支表达（F-44、H-1）

- 可写：`src/slicing/MarkerList.vue`、`tests/components/editor-panels.test.ts`。
- 使用现有 MEASURE_TICKS 替换 192；将 choose 的“普通点击 / Ctrl或Meta 加选 / 已选则移除”嵌套三元改成命名分支。不要为两个简单公式新增通用 formatter。
- 保持 cursor→selection→scroll→非播放时 playhead 更新顺序；保持 rowHeight=32、overscan/窗口大小和样式高度一致，不改变虚拟化策略。
- 验收：普通点击替换、Ctrl/Meta 增删、播放时不跳播放头、小节边界 191/192；沿用大列表虚拟化测试。模板行数上升是允许的。

### R9 — BMHelper 表达和单位可读（F-11、H-3）

- 可写：`src/bmhelper/BMHelperPanel.vue`、`tests/components/bmhelper-panel.test.ts`。
- 将 resetSettings 中 480 命名为用途明确的默认设置 TPQN 常量；create 仍使用实际 `store.project.source.quantize`。字段/局部函数明确区分界面拍数、MIDI tick 和编号文本，保留所有 Math.trunc 及校验顺序。
- 定义编号的 map/join 提取为 `selectedDefinitionNumbers` computed；copy 的三元链改成按 kind 分支。不同操作区在现有 `.actions` 之外增加语义 class，保留旧样式选择器和 DOM。
- 不把 480 与 BMH 的 48、ZZ 的 1295 合成同一常量；F-12/F-13 留给领域专项。不改 division 默认值、parseStart、文案或排序。
- 先不拆两个 dialog：pending、busy、error、settingsOpen 的开闭/异常顺序暂时仍由面板持有。若展开后确实仍难理解，再由协调者设计状态合同，不直接派“拆成三个组件”。
- 验收：已有 MIDI 导入/保存/剪贴板测试；补实际 quantize 非 480 的设置换算和小数截断、定义字符串、三种 copy 输出；取消后 pending 清空的时机保持。允许局部小函数，禁止通用单位转换框架。

### R10 — 集成与收尾

- 可写：进度文件、本方案的状态/导航更新、迁移 checkpoint；若发现产品回归，先回派原卡 owner，不扩大收尾范围。
- 对每张卡审查实际 diff、范围、行为证据，集中运行第 5 节集成检查；从画面中任选 fade、cue、BMH apply、波形色彩，要求能由导航直接定位 owner，无须跨无关包装层。
- 核对是否出现了“更少行但更多跳转”、新的重复状态、大量无意义 forwarding、万能 props 对象。存在则撤回该抽象或重新划边界，不能只凭测试绿接受。
- finding 回填区分：resolved / partial / retained-with-reason / deferred；保留原报告作为历史快照。F-7、F-8 都是 partial，F-8 不代表 F-42 解决。
- 本地 focused commit 由协调者完成；不 push/tag/publish。纯 refactor 不改版本、README 或 changelog。

## 5. 验证分层与失败处理

定向命令使用仓库已有脚本，例如：

```powershell
npm run lint
npm run fmt:check
npm run typecheck
npm run test:components -- tests/components/app-controls.test.ts tests/components/app-root.test.ts
```

lint/fmt 命令在 T0 配置后可用，T1/T2 基线未完成时记录已知违规；T3 上线后所有卡必须通过。pre-commit 按暂存文件快速检查，不能替代这里的集成检查。

按卡替换路径：R5 用 timeline-render；R6/R8 用 editor-panels；R7/R9 用 bmhelper-panel（R7 同跑 app-controls）；R1c 加 calibration、timeline-gestures、timeline-playback；R1d 加 bmhelper。测试文件列表以当前 vitest include 为准。

集成批次统一串行：

```powershell
npm run lint
npm run fmt:check
npm run typecheck
npm test
npm run build
npm run test:app-ui
```

- 只改排版复用现有行为测试，不写镜像实现的测试。协议抽取先补真实失败/取消/时序用例；组件改结构优先用 role/label/语义事件定位，不能依赖子组件第几个来掩盖断言退化。
- 现有 `project-workflow.spec.ts` 只证明一条打开/保存/重关联流程、菜单可见、无横向溢出、DPR/Canvas 宽度和无 pageerror；它**会截图，但没有截图差异断言**，也不覆盖全部页签/弹窗/主题。不能把跑绿当作外观完全等价。
- R0/R10 以固定输入和状态做前后视觉对照；只允许忽略构建时间等已记录的动态内容，不自动更新截图掩盖差异。CSS 搬移必须同时检查 computed style，不只比图片。
- 上面的 `npm run test:app-ui` 是现有工作流检查；新增视觉验收按 R0 的 runner 对每个“场景 × profile”独立执行。low=1280×720/DPR1，high=1920×1080/DPR2；各次运行独立启动/隔离用户数据，外层 30 秒硬超时，清理本次进程树后进入下一项。Canvas/DPR 用数值容差，服务和 DevTools 仅 loopback。不结束用户已有 Node/Vite 进程。
- 默认不为纯 UI 重构的每卡构建安装包。若要报告“完整应用构建/发行验收”，还必须按 AGENTS/CI 跑归档验证及相应真实 bundle 检查；web 双 profile 不等于原生 Tauri 窗口验证，IPC 探针也不是视觉验证。
- 同一输入前后导出字节、marker 顺序、dirty/undo、取消结果应保持；oracle fixture unavailable 写 skipped，未测平台写未测。基线失败与新回归分别记录，不跳断言、不扩依赖范围打包。
- 清理遵循移动到 `.pending-delete/<timestamp>/`，先验证路径在仓库内；不为恢复任务机械清空构建目录。现有脚本若与清理约束冲突，由协调者先处理，flash 不自行删除目录或改公共脚本。

## 6. 其余机器发现的处置队列

下面覆盖剩余 active ID，是**后续复核队列，不是本轮已修复清单**。仅重点 UI 项已逐处核对；其他项来自报告标题/证据摘要，派发前仍需核实当前调用方。不能将 deferred 记成 dismissed。

| ID | 本轮处置 / 后续边界 |
|---|---|
| F-7、F-8、F-9、F-10、F-11、F-39、F-44 | 纳入 R2/R4–R9；F-7 保留 close 的独立锁；其余须验收后才改状态 |
| F-12、F-13、F-16、F-21、F-23、F-30、F-42、F-45、F-47、F-49、F-54 | deferred：领域常量/合法域专项。先区分 UI 输入限制、旧格式迁移容忍、正式项目拒绝、会话恢复默认；不能把长得相似的校验统一成同一谓词 |
| F-17、F-18、F-26、F-27、F-28、F-31、F-40、F-51、F-52、F-53 | deferred：DSP/时基/绘制专项。先定舍入、夹取、取样与性能合同；长参数/长函数只是信号，热路径不强制对象化。测试 oracle 不能当普通死代码直接删 |
| F-46、F-48、F-50 | deferred：store 状态所有权专项，协调者先设计 Project/Session/Runtime 与 reset 合同。不能让 flash 一次“拆成六个 store”，也不能仅把 79 项返回对象套一层 facade |
| F-14、F-15、F-19、F-20、F-22、F-24、F-25、F-29、F-41、F-43 | deferred：核心解析/遗留 API/命名逐项复核。F-19 优先纠正名称/注释而不改字节序；F-24/F-43 的测试专用用途须先查清；撤出的文件移动归档 |
| F-1–F-6、F-36–F-38 | deferred：host/安全/构建合同专项，不混入画面清理。TS/Rust 边界可各自防御；命令生成器需证明 ACL 链完整，不能为消重放宽权限 |
| F-34、F-35 | deferred：主题/i18n 所有权与生成链专项，运行时离线和四语言一致性不变 |
| F-33 | deferred：检测异步协议，需同时保护 busy/finally、错误反馈与过期结果；不仿照确认框 helper 机械去重 |
| F-32、F-55、F-56、F-57 | deferred：测试可读性专项；保留独立 WAV 手写字节作为解析器 oracle 的必要性，不能让生产编码器与解析器共享错误后自证通过 |
| F-58–F-62 | 保持报告 dismissed；不因发现数量目标而重开 |

## 7. 交接模板

执行者只读本方案第 1/2/5 节、分配的任务卡和文件；需要其他文件可读，写入越界先报协调者。使用下面的任务提示即可开始，不再让低成本 agent 自选架构：

```text
执行 docs/refactoring/UI_READABILITY_PLAN.md 中的 R__，仅此卡。
基准：<当前已验收 commit>；前置卡：<ID/commit>；owner：<执行者>。
先核对 Git 状态和目标符号，报告与计划不符的地方；保留其他工作。
可写文件：<复制该卡白名单>。共享契约：<复制该卡合同>。
禁止改变产品行为、公共配置、依赖或其他状态 owner。
先保持现有行为可验证，再整理表达，再检查责任归属；不要为消除行数引入抽象。
运行：<typecheck + 本卡定向测试>。构建/UI 资源由协调者串行安排。
交付：改动文件、关键决定、实际测试结果、未验证项、遗留风险；停止写入交接。
不要 commit/stage/push，不修改任务状态文档；由协调者检查后记录和提交。
```

协调者在 `UI_READABILITY_PROGRESS.md` 为每卡记录 status、owner、输入 commit、允许写文件、实际输出、测试命令/结果/产物、未决问题和下一步；完成一张更新一次 checkpoint。没有运行证据的卡不能从 pending 变成 verified。
