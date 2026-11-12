# Vue / Tauri 实施计划与差异台账

2026-11-11 工具链决定（覆盖下文旧 Node/构建模式要求）：统一 Node **26.x**，`.node-version` 供本机版本管理器与 CI 共用，npm engines 与 `@types/node` 同步。本机 build/package 与 IPC 探针默认 **debug**；显式 `--release` 或 `WOSLICER_BUILD_PROFILE=release` 才切 release。CI 的 frontend、Cargo test/clippy、Tauri bundle 全部使用 release；Rust release 按体积优化并保留 unwind 以复用测试/构建依赖。命令与细节见 [CI.md](../CI.md)。这不改变 W6 未验证平台与原生 UI 验收状态。

本批状态：已实现并在 Windows x64 验证 Node26 干净安装、类型/质量/单测检查、debug/release Web 构建与双 profile UI/ZIP、Rust 两种模式测试与 release Clippy、两种模式 MSI/NSIS 构建及版本元数据；CI 配置通过静态检查，跳过重复 frontend hook 的 release 路径通过本机实际构建。证据与未测范围见 [RESUME.md](RESUME.md) 顶部记录。

2026-11-11 恢复批次（覆盖下文旧 CI/离线安装要求）：设计书先独立提交为 `a6728d4`。迁移后 CI 恢复 Web 与 Windows x64 必过、Windows ARM64/Linux x64/ARM64 可选；Rust cache 固定官方 v2.9.3 SHA；tag 直接公开 prerelease，按配置恢复 Pages。详见 [CI.md](../CI.md)。托管首跑与 native UI 双 profile 仍待验证，未执行 push/tag/发布。

用户明确：只有应用内部要离线；外部、安装器、依赖和系统运行时独立联网不属于应用责任。保持 Tauri 默认 WebView 安装行为，不捆绑运行时、不禁止下载、不支持缺少 WebView 引擎的系统。离线 WebView 分发不再是验收项。

状态核对基准：`feature/tauri`，**W2–W5 已完成；W6 主切换已落地**（W2：`6c57457`/`5375e68`/`fa1b652`/`53a5f57`；W3：`7c4a975`/`6828d6f`/`b6bad62`/`9e4e9fc`；W4：`de46b1f`/`9b81076`/BMH 提交），2026-11-10 JST。
此文描述目标和尚需实施的工作，不表示功能已全部实现。下一次工作从 [RESUME.md](RESUME.md) 开始。
证据见 [时序](THIRD_SESSION_EVIDENCE.md) 和 [最终批准原文](THIRD_SESSION_APPROVED_PLAN.md)。

## 1. 不再漂移的决定

| ID | 决定 | 明确边界 |
|---|---|---|
| D01 | 全新 Vue + Tauri 应用承载旧应用独有业务；TS 核心继续使用 | 不复制通用杂活，不重写 Rust DSP；不以旧 DOM/视觉/所有快捷键为兼容合同 |
| D02 | Vue Composition API + TypeScript、Pinia、Element Plus、Vue I18n、VueUse、Vite | 优先成熟生态；只做 light/dark，不造主题/翻译扫描/通用组件体系 |
| D03 | 业务菜单移到 Web UI 后逐项精简 | 平台不持有应用菜单命令、labels 同步或菜单事件 IPC；原生文件对话框/窗口能力仍属于 host |
| D04 | `.wos` 固定互通；`.wosdx` 独立版本完整项目，媒体不嵌入 | `.wos` 6,168 字节及外部行为不能改变；项目格式版本不等于应用版本 |
| D05 | 媒体事实、来源 hint、本机授权三者分离 | Web/Desktop 引用不可通用；hint 不授权，失联不妨碍打开项目 |
| D06 | 多轨、多 clip、leading silence、gain/mute/solo、global/track 视图先预留 | 本期不做多轨 UI/混音、自由片段编排、效果器、频谱分析；复杂合法数据受限打开且无损保存 |
| D07 | 单一 ProjectEditor 持有正式项目与有界历史 | 一次用户意图一次事务；失败/取消/no-op 不记历史、不清 redo；异步结果核对身份和修订 |
| D08 | 鼠标、键盘、菜单、按钮共享语义操作与可用性 | 未来手柄只预留输入适配与 bindings 类型，不加轮询或设置面板 |
| D09 | Project、Session、Config、Runtime、Host binding 分层 | Session 不是第二份项目真相；关闭项目不清配置；恢复失败不得默默覆盖原记录 |
| D10 | 新产品入口使用常规 Vite + Tauri CLI/bundler，CI 同步重做 | 旧 archive/symbol/Web 三文件/locale 裁剪/发布查找机制没有默认保留义务 |
| D11 | 离线、安全边界、许可证与版本规则继续有效 | 无运行时外网；root package version 唯一可编辑；保留 LICENSE/NOTICE，不宣称未验证兼容 |
| D12 | Rust 库入口 + 薄 main，预留 mobile 入口 | 本期不测 Android；不把结构预留写成移动平台支持 |
| D13 | 清理移动至待删除目录；可随时本地 commit | 不运行清理删除命令；不覆盖用户工作；未授权 push/tag/release/deploy |

## 2. 模块与状态所有权

依赖方向为输入/UI → 应用 use case → 纯项目/业务模型；应用通过 Platform 能力访问 host。
`src/core/` 的时间轴、切片、WOS、BMHelper/MIDI 等纯算法继续作为业务资产；不要把其塞进泛化 utils。
`src/project/` 不能依赖 Vue、Tauri、文件路径权限或 AudioContext。

| 层 / 入口 | 应持有 | 不应持有 / 当前差异 |
|---|---|---|
| Project：`src/project/` | ID、timing/slicing/output、媒体事实、global defaults、tracks/clips、BMHelper payload；事务历史 owner | 文件中不含历史栈、PCM、设备/窗口状态和 grant；`ProjectEditor` 已建立 |
| Session：`src/workspace/session.ts` | 恢复快照、项目身份与保存基线、本机 binding 索引、选择/光标/viewport/tab/grid/snap/检测工作参数 | 当前 v2 只有 dirty 布尔和 lastFile，没有完整保存基线与 binding 索引；检测工作参数和项目配方也需明确提交边界 |
| Config：`src/ui/preferences.ts` 等 | 主题、语言 auto、未来键位/手柄绑定、master/cue 初始默认、设备校准 | 默认只用于新工作区，不覆盖恢复值；窗口几何由 host 管；当前主要只有主题/语言 |
| Runtime：workspace/playback/detection/timeline | PCM、Worker、analysis、AudioContext、Canvas、busy/status、gesture draft、历史 | 不持久化到 portable project；tab 卸载不能丢失仍在运行的业务所有者 |
| Host：`src/platform/`、`src-tauri/src/` | 选择/读取/写入/剪贴板/本机恢复、窗口能力；projectId/mediaId → 本机授权 | originHint 不参与授权；browser token/handle 与 desktop grant 不互转；现有 1,024 grant 上限需生命周期回收 |

项目视图属性与“本次临时监听”应显式区分，不能简单把所有滑块都移入文件或都永远留在 session。
已批准的是项目 global/track 属性、有效值解析、保存恢复一致，以及 Config 的新项目默认值。
当前 volume/cue/rate/RMS/bands 的 session ref 是迁移阶段状态；新增功能要接回该模型，避免双写两个真相。

## 3. 原生菜单与输入处理

### 菜单处理流程

1. 用旧 `src/main/main.ts` 的菜单构建、`menu-i18n.ts` 和 renderer handlers 列出操作候选，按用户任务分类。
2. 对照新 `src/app/menu.ts`、`command-types.ts`、`commands.ts` 及面板入口，记录“保留 / 合并 / 裁剪 / 待评估”、理由及验收。
3. 保留的业务能力在 Web UI 可发现；不能只迁移一个不可见快捷键。菜单结构和原快捷键不必照抄。
4. 删除新 Tauri 原生业务菜单契约（以移动旧文件方式退出），不做 labels/event 同步。当前 Platform/Rust 已没有该菜单链。
5. 最终清掉退出产品入口的 Electron 菜单代码；迁移期间旧 lane 可作为参考，不作为永久验收对象。

以下是候选分组与当前状态，**不是已完成的逐项菜单审计**：

| 操作族 | 当前新入口 / 后续处理 | 验收重点 |
|---|---|---|
| 项目开存、音频打开/重关联、关闭 | Web project 菜单和工具栏已接入 | dirty 替换确认、missing media、复杂工程限制、失败无损 |
| WOS 导入导出、单片/全部音频导出 | Web 菜单已接入 | 明确与完整项目保存不同；不可表达字段不能静默损失 |
| Undo/Redo、切点、选择、剪切复制粘贴、量化/移动 | 菜单/键盘/画布/面板分布 | 同一合法性规则、同一事务与禁用原因，处理草稿冲突 |
| 播放/试听/速度/cue、缩放/栅格/吸附/视图 | 工具栏/面板与部分键盘 | 区分项目属性和会话操作，输入焦点一致 |
| BPM/shift/fade/gate、检测、编号/命名 | 项目控制与检测面板 | 原子参数提交、异步过期结果、单位一致 |
| BMSE 剪贴板、BMHelper/MIDI | 应用命令或 BMHelper 面板 | 保留独有业务；真实互通与项目保存生命周期仍需验收 |
| 主题/语言/About、窗口退出 | Web UI 配置与 host 窗口能力 | 不重造原生菜单；About 来自构建元数据 |
| MIDI 拖放、列表试听、旧快捷键别名等 | 候选，按价值评估 | 不以“旧版有”作为必须回补的理由 |

### 统一操作合同

- 输入 adapter 只解释 focus、按键、repeat、坐标和修饰键，输出 typed semantic command；领域层不接 DOM Event 或 Rust command 名。
- 命令在应用层拥有可用性、验证、冲突策略和反馈；MenuCommand 可以是 AppCommand 的展示子集。不要为消解历史文字冲突造两套业务命令。
- 菜单禁用状态与实际执行判断来自同一规则。modal、文件选择、未保存确认、busy 状态不能被快捷键或直接按钮绕过。
- 项目编辑（marker/timing/slicing/output/track/clip/BMHelper）提交一个事务；播放、光标、选区、viewport 等会话操作不自动进入项目历史。
- 指针 begin 捕获项目/修订，update 仅 preview；commit 一次；Escape/lost capture/切项目取消。其他编辑或 undo 先取消草稿，再执行。
- 异步 detect/decode/relink/import/save 核对 project/media identity 和 revision/generation；旧结果不得回写新项目。保存只确认实际写出的修订。
- undo/redo 的容量与文档大小要有真实测量；当前 200 个 immutable snapshots 只是起点，不引入 event sourcing/CRDT/通用总线。

## 4. 当前代码与最终要求的差异

状态符号：已建立基础 ≠ 整体验收；“待修”是计划要求未满足，不表示本轮已改代码。

| ID | 当前事实与源码入口 | 尚需实现 / 验收 |
|---|---|---|
| G01 | **已完成**：受限打开与原字节保存（5375e68，见 W2a.2）；未知字段经 `parseProject.unknownFields` 收集路径并在可编辑工程打开时以 `projectUnknownFields` 披露，保存规范化不保留已明确告知（53a5f57）；future 版本打开前抛错、不改动工作区、不落盘，原文件即保全 | 无未决项；复杂工程的媒体查看/重关联体验属 W4 项目属性范围 |
| G02 | **已完成**（W5）：跨入口取消（undo/键盘/项目替换打断草稿）有测试；200×2000 切点 undo 成本预算护栏；saving revision 守卫原有测试保持 | 历史精确内存数字留待 W7 报告补充 |
| G03 | 已修复（618d445）：`workspace/persistence.ts` 写以 attempt ACK 结算，失败经 `sessionSaveFailed` 可见、保持 pending、重试写出最新快照；dispose 失败上抛不静默；串行写与 close/reset 防复活行为保持并有回归测试 | W1 范围内无未决项；定时器失败已上报（不再吞错） |
| G04 | 已区分（5a40e7b）：`workspace/session.ts` 的 `readEditorSession` 输出 absent/restored/invalid/future/read-failed；非 restored 的原输入保留且恢复写暂停，打开内容前需显式确认丢弃（App.vue 对话框），`reset` 为显式清档 | 持久保存基线与 binding 索引仍缺（属 W3/G05）；被阻塞时状态条提示可被后续操作覆盖，暂无持久指示，W5 输入验收时复核 |
| G05 | session lastFile 从 decoded source 捕获，`reopen` 走 loadAudio | 失败会在下次捕获丢本机引用；成功重建也需验证不会重置项目 ID/媒体/dirty。绑定独立于 decoded source |
| G06 | `workspace/project-media.ts`、workspace relink 先 decode/比较 hash 等，匹配才绑定 | 不匹配当前硬拒绝；最终计划要求明确差异确认。取消/失败保留旧绑定；确认导致元数据变更时须走事务 |
| G07 | **已完成**（9b81076）：volume/cue/rate/cueMode/views 为 document.global 可写投影（一次意图一事务、参与 undo/dirty、limited 只读）；`masterAmp` 路由（mute 优先，track 投影为 schema 预留）；视图有效值 track 覆盖 ?? global；会话快照瘦身 + 旧归档迁移 | 无未决项；滑杆手势草稿化（拖动 preview）留待 W5 输入验收打磨 |
| G08 | **已完成**（本次提交）：store `bindEditor` 后每次 BMH 编辑经一个事务写通 `bmhelper` payload（参与 undo/dirty，32 MiB 上限预检）；projectId 切换自动从新文档重载工作副本；保存期新编辑不清 dirty（版本守卫）；面板改用注入的 workspace platform（重挂载稳定） | applyCuts 已有事务；同一 projectId 重恢复的极端重载边界已记录并接受 |
| G09 | `platform.importLegacySession` 只有选择/读取；旧 recovery doc/options 可纯转换 | legacy envelope 的显式 UI、纯迁移、差异预览、确认尚未串起；path/token 仅 hint |
| G10 | **已完成**（W5）：`menuCommandEnabled` 单源规则（穷举 switch）+ 33 例状态矩阵规则表；workspace gate/对话框拦截/快捷键失效均有测试 | 无未决项 |
| G11 | **已完成**（de46b1f）：cue 交叉重置仅随 markers/bpm/shift 值键；播放行为测试证明无关编辑不吞 crossing | 无未决项 |
| G12 | Tauri bounded chunk/final close 已有；reader 按 reference/grant 区分 | 不同引用并行已测，同一引用双读取仍需独立 transfer ID；grant 生命周期上限/取消清理需验证 |
| G13 | **已完成**（fa1b652）：拆为 `importWosSettings`（原地单事务导入时序/切点，保留 projectId/media/output，一步可撤销，无音频时不虚构媒体）与 `newProjectFromWos`（整体替换为新工程，走替换确认，清空 source）；`savedWos` 文案明确仅时序与切点 | 无未决项；BMSE/MIDI 互通验收仍属 W5 |
| G14 | 版本/标识符（2026-11-11 用户决定）：root version **1.0.0**（npm version 流程 + 双语 changelog 1.0.0 段，仅 UX 断言；Fixed 两项以旧 lane 静默吞错源码为据）；identifier **io.github.rirko.woslicer-dx**（应用数据目录随之更换，旧目录数据已迁移本机；tauri-ipc-probe 同步更新）。主入口已切（886e388）：`dev`/`build`/`package`/`typecheck`/`test` 跑 Vue/Tauri 链（typecheck/test 双链覆盖）；旧 Electron lane 改显式 `:*electron` 名；`tauri.conf.json` bundle.active=true（msi/nsis/deb/appimage + 图标集）；**真实 Windows 产物本地实测**（woslicer-dx_0.3.0_x64_en-US.msi + -setup.exe）；tauri npm 包对齐 crate minor（2.11）；build.yml 重写（真实 Ubuntu verify + windows/linux 打包 job，Rust 用 runner rustup，无 WSL）；release.yml/旧矩阵退场至 .pending-delete；docs/CI.md 重写 | native UI 双 profile、恢复后 CI 真实跑通（未 push）；Rust cache 已配置 |

保留旧 i18n key 以让旧测试通过是临时回归桥梁，不意味着以后继续维护旧菜单或旧 DOM 翻译体系。
对未知版本/扩展字段，“JSON 重新编码”不等于原始字节无损；详见 [格式文档](../PROJECT_FORMAT.md)。

## 5. 从中断处执行的工作包

下表沿用最终计划 A–F，不重新发明另一条迁移路线。优先级由当前数据丢失风险决定；每包完成后小步 commit。

| 工作包 | 原阶段 | 入口与内容 | 退出条件 / 依赖 |
|---|---|---|---|
| W1 恢复写可靠性 | C | G03/G04；persistence、session、workspace 和恢复状态 UI | **已完成**（618d445 + 5a40e7b，2026-11-10）：写失败可见且可重试；失败保持 pending；并发新修改不被旧 ACK 清掉；坏/future 记录确认前不覆写；close 不复活。下一包从 W2 开始 |
| W2 文档能力与无损边界 | A/C/D | G01/G13 | **已完成**（`6c57457` + `5375e68` + `fa1b652` + `53a5f57`，2026-11-10）：复杂工程受限查看与原字节保存；future 输入保留且不覆盖编辑；两类 WOS 操作语义清楚。下一包从 W3 开始 |
| W3 绑定与恢复身份 | C/D | G05/G06/G09/G12；session、project-media、platform/Rust reader | 绑定独立、恢复不重建身份、不丢 dirty；relink 差异确认；legacy 预览；transfer 隔离/回收。依赖 W1 的恢复结果模型 |
| W4 项目属性与 BMHelper | B/D | G07/G08/G11 | **已完成**（de46b1f + 9b81076 + BMH 提交，2026-11-10）：单轨 dB/mute/solo/视图投影可验证；cue 独立不漏事件；BMH 随项目开存/undo、切换重载、保存期守卫。下一包从 W5 开始 |
| W5 输入与业务生命周期验收 | B/D | G02/G10；commands/menu/actions/gestures/worker/export | 完成逐项操作清单和按钮↔键盘↔鼠标等价测试；modal/busy/取消一致；释放 AudioContext/Worker/RAF/observer/pointer capture；不加手柄运行时 |
| W6 产品入口与常规构建 | E | G14；package scripts、Vite、Tauri config、CI/version docs | 新 Web/Tauri 是正式入口；旧工具按引用清理退出；真实产物测试、平台前置依赖、Rust 缓存与默认 Tauri 分发；依赖前述业务可验收 |
| W7 最终审查与交付文档 | F | 历史 smell findings、许可证、README×4、changelog×2 | 每个 finding 有 disposition；只写实际 UX；真实验收矩阵，未测/fixture unavailable 保持明确；无未授权发布 |

W2 的具体起手用例及命令见 [恢复指南](RESUME.md)。每包可以拆成更小可提交单元，不把整包堆到限额末尾。

2026-11-11 用户新增界面可读性规划：W7 的 smell 处置输入更新为 HEAD `44a8192` 对应的 `.smell-check/20261110-180802Z`（57 active / 5 dismissed）。[界面等价重构方案](../refactoring/UI_READABILITY_PLAN.md) 已完成编写，R0–R10 均待实施；先处理模板/样式映射与局部重复协议，其余 findings 显式延后复核。本次仅制定方案，不改变 W6 未验收状态，也不把后续队列记为已修复。

同日追加 [lint/fmt 与 commit hook 工作包 T0–T3](../refactoring/LINT_FORMAT_PLAN.md)：先用 Oxfmt 建立统一格式基线，ESLint flat config 覆盖 TS 类型规则和 Vue 模板，再启用 Husky/lint-staged pre-commit 只读检查与 CI 全量门禁。替代 R1 的纯手工排版工作；开发工具依赖/config/hook/CI 由协调者统一所有。状态均为待实施。
除非新证据或用户改变优先级，下一次恢复不要重新从菜单样式、旧 packaging 优化或新多轨功能开始。

## 6. 构建替换与验收门槛

- 最终 `dev/build/test/package` 面向 Vue/Tauri。当前 `*:app` 附属脚本只是过渡，不算成为正式产品。
- Web 使用 Vite 生产目录在 Chromium + Firefox 验证。旧 `test:web` 面向旧 renderer，不能当 Vue Firefox 的证据。
- Tauri 用 CLI/bundler 标准目标产物；不保留手工 archive 重写、locale 裁剪、符号包、三文件 Web 等旧合同。minify/source map 不是本轮优先事项。
- 按实际支持的 OS/arch 建 CI：Node26 + npm ci + Rust locked toolchain/deps + 目标系统依赖 + 固定 SHA 的维护中 Rust cache action。测试、Clippy 与打包均用 release；缓存不替代 fmt/clippy/test。
- Windows WebView 安装按 Tauri 默认行为，外部依赖联网允许，不捆绑运行时。
- root package.json version 是唯一可编辑版本；构建期 commit/dirty/固定 UTC 时间；按现有 VERSIONING 规则检查。
- 按用户要求恢复 tag 发布与可配置 Pages，详见 docs/CI.md；本地不执行 push/tag/发布。
- Native UI 独立 low 1280×720/DPR1、high 1920×1080/DPR2，真实缩放/菜单可见、隔离用户数据、每 profile 独立 30 秒硬超时、完整清理本次进程树、动态 loopback DevTools 端口。浏览器模拟 DPR 不能代替原生。
- **双发行约束（2026-11-11 用户决定）**：web（浏览器版）与 desktop（Tauri 版）同为发行目标。平台通信改动只允许落在 `platform/tauri.ts` 与 Tauri 前端变体，web 变体保持最严 CSP；每次发行需两版各自验证（web：`test:app-ui` 双 profile；desktop：`test:tauri-ipc` 传输探针 + native 冒烟）。
- **新架构画面测试（2026-11-11 用户要求）**：`test:app-ui`（Playwright，Chromium 1280×720/DPR1 与 1920×1080/DPR2，dist/app 生产目录）为 web 版画面基线；`test:tauri-ipc`（scripts/tauri-ipc-probe.mjs，CDP 直连产物 WebView2）为桌面 IPC 传输健康测试；**`test:tauri-ui`（scripts/test-tauri-ui.mjs，2026-11-12 落地）为 native 窗口级双 profile**：CDP 直连驱动真实 WebView2（动态 loopback 端口、逐 profile 隔离应用数据、30 秒硬超时、进程树验证清理），low=1280×720 css 视口@宿主自然缩放、high=1920×1080 物理@强制 DPR2；断言菜单栏可见、devicePixelRatio、canvas×DPR 尺寸关系并留截图。工具路线说明：初拟 tauri-driver（Windows 链还依赖 msedgedriver 版本匹配，且 wry automation 对 additional browser args 的合并行为不可控），改为沿用 tauri-ipc-probe 的 CDP 直连模式——同样满足"真实窗口/真实 WebView/动态 loopback 端口"验收点且零新依赖。已知宿主限制：150% 系统缩放下 DPR1 且 <1440×900 物理的窗口被应用 960×600 逻辑最小尺寸钳制不可达，DPR1 组合留待 100% 缩放的真实平台验收。
- Rust MSRV 政策（2026-11-11 用户决定）：`rust-version` 跟随最新 stable 工具链（当前 1.99），tauri 家族随 minor 最新对齐（crate 2.12.5 ↔ npm api/cli 2.12）；升 minor 时同步抬 MSRV 并双端（Windows/WSL Linux）实测。
- Rust cache 已固定官方 v2.9.3 SHA，按 OS/target 分离；fmt/clippy/test 照跑。
- 本机 WSL 已可运行 Tauri（WSLg）：native Tauri 冒烟可作为**本机的显式验证路径**——仅限本机、必须显式调用；不得写进默认脚本，不得在其他人的机器上隐式启动 WSL。CI 的 Linux 目标一律交给真实 Ubuntu runner，不接受 WSL 代替；WSL 产生的证据标注为"本机验证"，不等同标准目标平台验收（后者仍属 W6 常规打包）。
- 完整构建报告必须含类型检查、业务/组件测试、UI profiles、归档检查；必需步骤失败先诊断，不继续打包。只对实际测过的平台作声明。

## 7. 每次交接必须更新

在 RESUME 中写下提交、工作树状态、当前工作包、具体下一步、已执行命令/结果/跳过原因、未完成验证和临时产物位置。
在本文件更新对应 G/W 状态和依据；新增需求才更新 D，不把实现妥协改写成已获批要求。
完成代码修改时先读对应 TypeScript/Vue/Rust 等 skill；W2 各步的入口、文案与禁用状态均已按用户可见行为验收。
