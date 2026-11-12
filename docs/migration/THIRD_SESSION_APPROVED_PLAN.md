# 第三次会话：最终获批计划原文

此文件是历史证据，不是当前完成状态。执行入口见 [恢复指南](RESUME.md)，
当前解释与差异见 [实施计划](../VUE_TAURI_MIGRATION.md)，时序见 [决策证据](THIRD_SESSION_EVIDENCE.md)。

- 来源：Zcode session `sess_18183a23-c4a4-452e-b7fd-e7e73cda40f3`，消息序号 369。
- 工具：`ExitPlanMode`，状态 `completed`，输出明确确认用户批准。
- Part ID：`part_mw9mydmc_6430719c-de09-4310-a43b-256db05eabfc`。
- 批准时间：2026-11-09 19:13:10.399 UTC / 2026-11-10 04:13:10.399 JST。
- 下方正文逐字保留 `state.input.plan`；换行统一 LF。未复制数据库、凭据、工具原始日志或其他会话。
- 正文 SHA-256（不含边界标记与外围空行）：`1cff13d844606689a95a944955a327de449749bdadb586fc800d3ce1f3bf0a70`。
- 原文中的“删除”按用户后续指令执行为移动至待删除目录。
- 原文末尾要求单独授权提交；当前用户已明确授权随时本地 commit。push/tag/release 没有获得授权。
- 原文“Menu command 和 internal keyboard command 不再同属 AppCommand”与第 5 节统一语义命令存在表述冲突；当前实施解释为命令属于应用层，菜单是可展示子集，平台层不持有菜单契约。
- 原文“不改旧 app 是目标”与上下文整体替换目标不一致；不据此追加永久维护旧应用的要求。依照用户明确指令保留独有业务，重建通用设施。
- 原文含缓存 action 的归属表述；实施时核验所选维护中 action 及固定 SHA，不将原文称谓当作供应方事实。

<!-- BEGIN APPROVED PLAN -->

## Context

本方案汇总此前已批准的 Vue + Tauri 迁移原则及新增的数据/工作流决定，替代此前建立在旧 renderer 和旧 packaging pipeline 之上的实施顺序。当前变更仍未通过整体验收；下一阶段按新设计重建项目/编辑边界，再把新 Vue/Tauri 应用接为唯一 Web/桌面产品入口。

已确认目标：

- 新 Vue + Tauri 架构承载现有独有业务；成熟 Vue/Tauri 生态承担通用组件、状态/翻译/构建和原生系统能力。
- 不把旧菜单、旧视觉、旧快捷键、旧 Store、旧 session 布局或旧 CI/打包细节当兼容要求。旧操作先作为功能素材，迁入画面菜单和统一命令后逐项裁剪。
- `.wos` 是其他程序依赖的固定外部格式；严格保持现有字节格式、读写行为和用途，不在其中追加字段。
- 新项目格式使用 `.wosdx`，媒体不嵌入，保存来源提示和基础元数据。路径提示不能授权访问，host grant 不可移植。
- Desktop 与 Web project/doc/API 一致，但两端媒体引用类型完全隔离，不能互相转换；媒体缺失时项目仍可打开并手动导入/重关联。
- 新 schema 预留 tracks、clips、多轨增益/mute/solo、视图覆盖和谱视图字段；首期只支持当前单轨流程，不实现多轨 UI/混音、片段编排、效果器或频谱分析。
- 编辑采用原子业务操作与 Undo/Redo；按钮、画布、键盘和未来 gamepad 适配器共享业务规则。
- 不改旧 app 是目标；旧项目存档只提供一次性数据迁移，不要求旧 UX 无损迁移。

调查证据：当前 `.wos` 是 `src/core/wos.ts` 的固定 6,168 字节；`AudioSource`、音频 Worker、Timeline、Playback 和 exporter 仅表达单一 whole source；音频源的 `length` 是每声道 source frames。markers 以 192 ticks/measure 和 49,152 ticks 为坐标，marker tick 通过 BPM/shift/sampleRate 转为源帧。Track/Clip 的 timeline 时间和媒体源帧必须为不同字段。当前 Canvas RMS/频段为视图，不是混音控制；cue 有独立输出。

## 1. 新 `.wosdx` ProjectDocument

新增纯 TypeScript `src/project/`：schema 类型、边界解析/校验、序列化、能力判断和文档编辑；不依赖 Vue、宿主、文件路径或音频设备。

- `.wosdx` 首版采用带大小上限的 UTF-8 JSON；具备固定 format ID 和独立 schemaVersion。项目格式版本不等于 `package.json` 应用版本、workspace session key 或 Tauri crate 版本。
- 建议逻辑模型：根包含 `projectId`、名称、项目 timing/slicing/output 配方、media records、global playback/view defaults、tracks；每个 track 有多个 clips。
- `MediaAsset` 保存稳定 `mediaId`、原名/扩展、可知的 byte length、格式、采样率、声道数、frames-per-channel，以及可选 SHA-256。派生时长；字段未知时显式 null。
- Media origin 是 discriminated union：desktop path hint 或 browser 来源 hint。二者完全不兼容，不将 fake path、Blob URL、picked token、FileSystemHandle、Tauri UUID 放入共享 path 字段。路径 hint 只是辅助信息，非权限。
- Track 保存稳定 ID/name、track gain dB（有限范围，0 dB 为 unity）、muted、solo、RMS/bands/spectrum view overrides 及 clips。静音和独奏独立于音量。
- Clip 保存稳定 clipId/mediaId、timeline start seconds、source offset frames、frameCount。源坐标单位绑定媒体的 sampleRateHz；长度有整数和上限约束。
- 默认一条轨道、一段完整源音频、位置零。timeline start > 0 能表达开头空白；一个 track 可以包含多个 clip，数组顺序不隐含位置。重叠数据可保存，但首期不承诺混音或 crossfade。
- 视图覆盖语义：global RMS/bands/spectrum 是全轨默认值，track 值支持 inherit/on/off，显式 track override 优先。band detection 的 bands 选择不是 envelope visibility，分开存。frequency spectrum 首期固定为 reserved/unsupported，不能表示已启用。
- Playback 语义预留：`hasSolo` 时只听未 mute 且 solo 的轨道；mute 优先；多个 solo 可同时有效；0 dB unity；masterMute 控制素材总线。Cue 独立路由与既有定义明确，不混同轨道音量。具体多轨求和、peak headroom 和响度策略本期不实现。
- 校验 format/version、文件字节数、唯一 ID、ID 引用完整、有限数值、frame/offset 边界、track/clip/media 资源预算。未知版本原样保留，不进入可覆盖编辑态。
- 复杂 arrangement 可无损读取/保存并显示受限状态；当前 playback/export/marker UI 不可把它静默压平到第一个 clip。只支持当前单轨布局的路径以能力判别支撑，不假装未来行为已实现。

## 2. Project / Session / Config / Host 分层

| 层 | 范围 | 明确不包含 |
|---|---|---|
| `.wosdx` Project | timing、slicing、outputRecipe、媒体基本事实与来源提示、global playback/view 项目缺省、tracks/clips、BMHelper 项目数据 | PCM/cache、宿主授权、窗口布局、历史栈 |
| Workspace Session | 当前 projectId、自动恢复用文档快照和 saved revision、本机 media binding、当前工作区选择/viewport/tab/grid/snap/检测工作参数 | 第二套独立 project truth、全局默认、播放实例 |
| Global Config | light/dark、language/auto、键位/gamepad bindings、master/cue 默认、device calibration；窗口几何归 host-managed settings | 当前项目文档 |
| Runtime | decoded PCM、peaks/analysis、Worker/AudioContext/Canvas、status/busy、preview、Undo/Redo transaction history | 持久化到项目文件 |
| Host-local binding/grant store | `projectId/mediaId` → 本机授权读取方式；Tauri grant UUID / Web 的 origin-local handle | portable project JSON 和跨 host 转换 |

唯一 project working copy 由 domain editing owner 管理。Session 的恢复副本绑定 projectId + saved revision，恢复/覆盖冲突必须明确提示策略。Config defaults 只用于新 workspace 创建，不覆盖恢复值。关闭项目清 project/session，却不清全局 config。

当前 host grant `HostFiles` 的固定 1,024 条限制须增可回收生命周期。无法恢复的 future/invalid/corrupt session 不等同于 absent；保留原记录，告知恢复状态，确认前不覆盖。

## 3. 媒体打开与手动重关联

- 先校验并打开 ProjectDocument，不以 source decode 成功为前提。
- 每个 MediaAsset 保留 unresolved/ready/failed 状态。所有来源丢失时仍可查看/编辑项目参数和存档切点。
- Tauri 仅通过 OS 文件选择生成新的 host grant；browser 重新选择 File。导入 project 中的 desktop path 或 browser hint 均不能绕过 picker。
- 用户手动 relink 后先 provisional decode，再核对已存 basename/size/format/rate/channels/frame count/hash；文件名匹配本身不证明身份。存在差异时显式确认。
- decode/确认成功才原子替换该 media binding；取消/失败保持现有 project 和 binding 不变。
- 浏览器无可复用 filesystem path，重新选择媒体是正常流程。必要的 FileSystemHandle 若以后实现需单独 origin permission/persistence 设计。
- `.wos` 导入只把其可表达字段映射到 ProjectDocument 的 slicing portion；不凭空生成已关联媒体。导出 `.wos` 是有损投影，UI 明示并拒绝 fractional gate 等不可编码值；多轨文件不允许静默 flatten。

## 4. 原子编辑与 Undo/Redo

当前 `MarkerDoc` 的 undo 只保存 marker bitmap；BPM/shift/fade/gate 等参数没有进入历史；旧 `.wos` load 曾复用历史 bitmap而新 workspace路径已创建新 doc。目标是项目文档整体历史。

- 单一 ProjectEditor/transaction owner 提供 typed edit operations；核心 model functions 负责 pure planning/validation，commit manager 只提交成功变化。
- 一条 undo item 至少包含 ProjectDocument 的 marker/timing/slicing/outputRecipe/track/clip 变更。Unity of command：一次 UI/user intent 一条 history；no-op/reject/cancel 不记历史且不清 redo。
- 起步可用 bounded immutable document snapshot/structured patch；不用事件溯源、CRDT 或泛化命令总线框架。用真实历史容量、文档大小/耗时测试判断快照是否足够。
- `.wosdx` save 成功记录写出的 revision；保存中继续编辑时新 revision 仍 dirty。Undo/Redo 与 project save state一致。
- pointer Begin 对项目/revision建 draft，Update仅更新 preview；不写正式 doc、不触发 Autosave。Commit做一次合法性校验和事务提交；Escape/lost capture/换项目取消。其他编辑或 Undo 来临时，协调层先取消 draft 再执行命令，不允许 bitmap snapshot 回滚同期操作。
- 异步 decode/detect/relink 结果带 project/media identity + revision，迟到结果不能覆盖新工作区。

## 5. 输入 adapter 和画面菜单

- Application command type/list/enablement 放在 `src/app` 或 `src/project/application`，不是 `src/platform`；Host capability 只表示 open/relink/save/clipboard/session/window 等系统能力。
- 一个语义命令 handler 接收按钮/画面菜单/键盘/指针/gamepad 产生的 typed command。不把 DOM `KeyboardEvent`、`PointerEvent` 或 Tauri command name 放进领域层。
- 所有输入适配器调用同一 transaction/use case：SetTiming、SetProcessing、Add/Remove/Move/Paste/QuantizeMarkers、SetTrackPlayback、SetViewOverride 等。鼠标末端合法性、键盘落点和未来手柄共用同一函数。
- 旧 Electron 菜单仅作为操作候选清单，逐项在新的 Web UI 菜单评估，不要求保留其结构/全部快捷键。删掉新 Tauri native menu/labels/event IPC/Rust menu module及其权限；将内容搬到 Element Plus Menu，并按价值精简。
- 未来 gamepad 只预留 adapter contract/bindings type；本次不绑定 navigator.getGamepads，不做控制面板或设备轮询。Menu/button/keys/pointer 共同命令测试验证架构确实可复用。
- 菜单/键盘打开/导出等命令会在 modal/dialog 期间明确焦点所有权和可用性，不能绕过确认流程。

## 6. 已发现的问题修复映射

本次按根因处理，而不将旧 UX 回归测试当目标：

- Menu command 和 internal keyboard command 不再同属 `AppCommand`，且不再向 Tauri 传 40 项 labels。
- 手势 draft 与 document command 排序统一，防止取消回滚同期编辑/Undo。
- Parameter edits 与 marker edits 进入同一 project transaction；setTicks/no-op不清Redo。
- BPM/shift/sample/frame/timeline seconds单位明确；一个 `isLegalMarkerTick` 源服务所有输入。
- Cue crossing 由 marker/timebase revision精确处理，非marker processing parameter改变不跳过播放事件。
- Media relink/worker/import异步旧响应检查project+media identity，并先decode再替换。
- BMHelper异步任务由稳定workspace service持有，不让 tab unmount 的闭包回写旧工程；保存完成用project revision判断 dirty。
- 自动存档失败显示清楚状态且保留dirty待重试；保存期间新修改保持dirty。
- Tauri分块读有独立 transfer ID+final close，不互清其他reader；用户取消只撤销当前事务。
- `.wosdx` legacy migration明确调度/确认；路径从不授权。坏档与future version单独提示且不覆盖源文件。
- Panel切换和应用生命周期释放、Pointer capture、AudioContext、Worker、RAF、ResizeObserver、导出清理有行为测试。
- MIDI拖放/列表试听/旧快捷键作为产品候选，不默认强行回补；新的commands inventory由用户行为和冗余价值确定。

## 7. Packaging/CI 重做（采纳用户最新指示）

**清除自制旧 packaging machinery，使用常规 Vue/Vite + Tauri 打包链。** 这取代早期方案里“保留旧 archive/symbol package/三文件 web contract/matrix/release lookup”的打算。

- Vite/vite-plugin-vue + tauri CLI 为唯一新应用开发/构建/打包入口；Tauri 官方 bundler负责 Windows/Linux/macOS 标准产物。
- 静态 Web 直接发布 Vite 产物并以其目录serve做Chromium/Firefox测试；不再先用 esbuild自建 bundle，再特制copy/minify/zip工具重新封装。
- 删除旧 `bundle-app.js` / package-app / platform-specific archive rewriting / electron locale pruning / symbol tarball等纯Electron配套脚本和Tests，除非新的用户业务仍引用它们。
- CI 用简洁的Node24 + npm ci + Rust toolchain + Tauri prerequisites + 官方 `Swatinem/rust-cache` (or maintained official-compatible cache action pinned SHA) + `npm run check:version/typecheck/test/build/test:web` + tauri build组合。按受支持 OS/arch定义matrix，不保留旧 payload双段上传、release artifact查找/提升、源码map archive等自制流程。
- Rust缓存只缓存Cargo依赖与build输出，不改变验证语义；锁 Cargo.lock，CI跑`cargo fmt --check`,`cargo clippy --locked --all-targets --all-features -- -D warnings`,`cargo test --locked`。注意本仓库实际Linux/macOS Rust依赖与GTK/WebKit bundling要在目标job安装系统依赖。
- npm root version仍唯一可编辑版本，Tauri配置读取root package，构建期生成完整commit/dirty/固定UTC时间；版本gate/README四语言和中英changelog规则保留，但简化README的build命令。
- 固定Windows WebView2分发/离线要求由Tauri bundler常规设置解决并验包；不假定portable installer/包一定更小。测试只针对实际标准产物，不测试一个自制二次打包容器。
- 删除部署/发布等新通道不在授权范围；需要保留组织现有发布机制时先盘点并精简，不能为“clean slate”擅自触发公开部署/tag/release。
- `.github/workflows/build.yml`, `release.yml`, package scripts, docs/CI.md, docs/VERSIONING.md最后重写；旧E2E源码/夹具只在新产品验证确有需求后保留或改造。

## 8. 实施与验证阶段

### Phase A — `.wosdx` schema 与纯 codec

新建 `src/project/`、`tests/project/`、`docs/PROJECT_FORMAT.md`。
先写失败用例：format/version dispatch；basic media metadata；desktop/browser不兼容reference；IDs/reference integrity；schema错误；track gain/mute/solo/overrides；clips leading silence/offset/range；当前single-track投影；复杂tracks/clips roundtrip losslessly；unknown/future version不被重写；JSON字节上限；`.wos` size/bytes回归不变。

审议并固定 schema constants、JSON encoded size/fields限制、数值范围、`gainDb`下限（建议最小可听 −96 dB 到 +12 dB仅若允许增益；若用户仅希望衰减则以0 dB上限）和全局视图默认。未实现的spectrum为`reserved`状态，不接受伪造运行值。

### Phase B — 项目事务历史和输入命令

统一 MarkerDoc/project editor store/application service。事务先检查基线再提交，外部适配只发语义命令；pointer 使用draft/preview。状态 UI和Undo/Redo动作来自同一命令owner。加入键盘↔按钮↔鼠标同操作结果对照，未来gamepad adapter type仅文档/纯映射模型，不运行设备API。

### Phase C — Project/Session/Config及遗留迁移

`.wosdx` reader/writer和文件名选择；workspace按projectId保存dirty recovery；config保留theme/language/master defaults。显式 `.wosdx` `Open`/`Save`，`.wos` `Import`/`Export`表述清楚。
Legacy v1 JSON选择后交纯迁移函数，产生新Project recovery和config/session，带差异预览/确认；旧path/Picked token仅hint。恢复失败保留输入及现有project。路径失效不阻止项目打开。Web/Tauri可分别保存相同project bytes。

### Phase D — Media binding/relink和单轨现有业务对接

平台picker和browser File路径各自分支；先stage/decode/metadata compare，确认再提交binding。支持缺失media工程打开/改项目/保存；media-required命令给恢复操作入口。current source projection用于timeline/playback；如果data包含多轨/片段当前UI不支持，给非破坏性限制页，不进入普通编辑，不将第一个clip伪装成整项目。

View model明确global defaults+track overrides；单轨Timeline只使用有效视图解析结果，保存及恢复一致。当前band绘制复用 `drawBandEnvelope`，RMS复用 `drawWaveLane`；频谱仅placeholder schema，不产生UI/分析请求。track playback schema用dB；首轨的播放测试覆盖0 dB、静音与solo单轨语义可辨，cue/master语义单独验证，但不实现多轨求和。

### Phase E — Web/Tauri app 与 packaging/CI 清理

迁移完成到Vue App后，删除旧Electron目录、preload/IPC菜单和renderer订阅/DOM翻译扫描；抽取并保留仍被新应用消费的纯算法/test。新App调用画面菜单，平台能力无native menus。

清理旧构建层，切换Vue/Tauri官方常规命令。Rust cache减少CI时间但不充当正确性检查。正式Web/Tauri构建和归档都检查 `.wosdx` save/open/relink；未测试OS明确列出。保持离线CSP/授权，不引入网络依赖。

### Phase F — 最终review/文档

按新数据模型重跑范围明确的架构审查，回填smell finding处理状态；不重构将删除的legacy packaging代码。更新docs/README/changelog仅写实际面向用户行为，保留许可证/NOTICE。提交、push、tag、release仍需单独授权。

## 9. 完成标准

- `.wos`完全不变，`.wosdx`具有明确独立版本/schema和可验证往返。
- 轨道/片段视图、master/track属性和宿主路径hint意图都被准确保留；Desktop/Web reference绝不混淆或授权。
- 缺失媒体工程可打开、编辑非媒体内容、手动重关联；失败不会覆盖旧状态。
- 单轨当前实现真实运行；未来多轨/片段数据保留并显式受限；Spectrum明确未支持。
- 每项项目更改原子提交、Undo/Redo一致；输入适配器共享相同业务handler。
- 异步保存错误可见并重试，过期任务/并行读取不损坏当前项目。
- 新Vue Web/Tauri成为实际CI/packaged产品，不再仅有附属构建路径；旧打包/CI自制轮子退出或有明确必要依据。
- 全面npm/Vue测试、真实Web产物、Rust与各可用Tauri平台包有真实报告。oracle fixture unavailable保持skipped。未测试平台不声称通过。

This revised plan adds a first-class versioned `.wosdx` project, immutable `.wos` interoperability, host-incompatible media references, reserved track/clip and track/global controls, shared input-command transactions, legacy migration, and a clean conventional Vue/Tauri packaging/CI replacement. No files were changed in this planning phase.

<!-- END APPROVED PLAN -->
