# 从这里恢复 Vue / Tauri 移植

最后核对：2026-11-10 JST。本文是跨聊天、工具、机器和额度恢复入口，不依赖任何会话服务。
仓库相对路径可直接使用；下方 Windows 绝对路径仅是这次环境记录。

## 1. 当前任务与检查点

- 2026-11-10 本轮：**W1 恢复写可靠性已完成。** W1a `618d445`（写 ACK/失败可见/重试/dispose 上抛）、W1b `5a40e7b`（恢复结果区分 absent/restored/invalid/future/read-failed，坏/future/read-failed 原输入保留，恢复写暂停，打开内容需显式确认丢弃，`reset` 显式清档）。
- 2026-11-10 续做：**W2a.2 受限打开与保全保存已完成（`5375e68`）**：复杂布局只读打开、editor 层单点拦截、保存原字节、恢复还原保持只读且保存明确不可用。
- 2026-11-10 W3 起步：**G12 已完成（`9e4e9fc`）**：reader 改为按独立 transfer ID（新增 `begin_read` 命令；grant/reopen 不再插 reader；chunk/close 按 transfer 定位），同一引用双读取拥有独立句柄与 seek 位，先结束的 transfer 不再影响后者；16 MiB 检查移到开 reader 之前；grant 生命周期有测试（同路径复用引用、1024 上限拒绝新 grant 且既有可 reopen）。Rust fmt/test(12)/clippy -D warnings 全过；前端 adapter mock 已迁移并全绿。
- 2026-11-10 W3 起步：**G09 已完成（本次提交）**：`Platform.importLegacySession` 进入契约（browser/tauri 各自接线）；`convertLegacySession` 纯转换信封（`{version,session}` 内层走既有 legacy 解析）；`importLegacyRecovery` 命令+菜单项：读取→摘要预览（名称/BPM/偏移/切点数）→App 对话框确认→整体替换并恢复；legacy `lastFile.path` 仅 hint，归档 lastFile 为 null，reopen 不触发；拒绝/非 legacy 文件不动工作区。
- 2026-11-10 W3 起步：**G06 已完成（`6828d6f`）**：relink 不匹配改为可选采纳——`confirmRelinkDifference` 回调（App.vue 对话框，4 语言），确认后以一次可撤销事务更新媒体元数据（名称/格式/字节/采样率/声道/帧数/完整性）与 clip 帧数，mediaId 稳定；拒绝或未接线保持硬拒绝且不改动；对话框期间并发编辑经 revision 守卫作废。
- 2026-11-10 W3 起步：**G05 已完成（`7c4a975`）**：音频绑定改为 `editor.lastFile`（独立于 decoded source 生命周期）——解码失败/取消不清绑定，归档持续携带 lastFile；restore 先种绑定再尝试 reopen，失败后下次归档仍保留；reopen 成功不重置 projectId/媒体/dirty；`reset`/打开工程/`newProjectFromWos` 清绑定，reference 为 null 的加载清除绑定。
- 2026-11-10 续做：**W2 全部完成**。W2b `fa1b652`：WOS 拆为 `importWosSettings`（原地单事务、保留身份/媒体/输出、一步撤销、无音频不虚构媒体）与 `newProjectFromWos`（整体替换、走替换确认、清空 source）；`savedWos` 文案明确仅时序与切点。`53a5f57`：`parseProject.unknownFields` 收集未知字段路径，可编辑工程打开时 `projectUnknownFields` 披露“保存不保留”；future 版本打开前抛错不落盘（原文件即保全，处置已记入 PROJECT_FORMAT）。
- 工作分支：`feature/tauri`。本轮起点 HEAD `777cf0e`；W2a.1 检查点提交位于其后（用 `git log --oneline -3` 定位）。
- 恢复时先核对 HEAD/diff；本文记录的是上述检查点，不覆盖后来已经完成的工作。
- 本轮改动归属：codec/schema、project 测试及三份迁移/格式文档，全部属于 W2a.1；无用户遗留修改。提交后核对工作树干净。
- **W3 绑定与恢复身份四项（G05/G06/G09/G12）已全部完成**；下一包 **W4 项目属性与 BMHelper（G07/G08/G11）**。不要先回去美化原生菜单、重构旧打包工具或实现多轨混音。

阅读顺序：本文件 → [实施计划](IMPLEMENTATION.md) → [项目格式](../PROJECT_FORMAT.md)。
追溯原话时读 [决策时序](THIRD_SESSION_EVIDENCE.md) 和 [获批原文](THIRD_SESSION_APPROVED_PLAN.md)。
两者的关键结论已纳入实施计划，日常续做无需重新挖数据库。

## 2. 不可丢失的约束

1. 新 Vue/Tauri 复制独有业务；TS 核心继续用。通用设施用成熟生态，旧 UX 不必照搬。
2. 原生业务菜单迁到 Web UI 后裁剪；输入共享语义命令、可用性和确认，gamepad 仅预留接口。
3. `.wos` 固定；`.wosdx` 是完整项目且不嵌音频。路径 hint 不授权；Web/Desktop 本机引用不互转。
4. 多轨/多 clip 只设计数据；复杂合法项目受限打开并保全保存，不假装可播放/混音/flatten 导出。
5. 项目事务一个 owner、一次用户意图一个 undo；无效/取消/no-op 不清 redo；异步结果检查身份/修订。
6. Project / Session / Config / Runtime / Host binding 分清；恢复失败保留输入，保存错误可见、可重试；关闭不被迟到写复活。
7. 正式构建最终切换常规 Vite/Tauri；旧打包轮子退出，不能为保持它们而漂移。原生/归档尚未验收。
8. 离线运行、严格类型、许可证、root version、真实测试声明遵循 AGENTS.md。清理移动不删除，定期本地 commit，不 push/tag/release/deploy。

## 3. W3 的直接起手步骤

先读 `src/workspace/session.ts`（lastFile 捕获与恢复）、`src/workspace/project-media.ts`（relink 硬拒绝）、`src/platform/` 契约与 `src-tauri/src/` reader（transfer/grant），及对应测试 `tests/app/workspace.test.ts`、`tests/app/project-files.test.ts`、`tests/app/platform.test.ts`。
编辑前加载当前工具可用的 TypeScript/Vue skill；G12 涉及 Rust 时再读 Rust skill。

当前现状：G05 lastFile 从 decoded source 捕获、reopen 走 loadAudio；G06 relink 不匹配当前硬拒绝；G09 `platform.importLegacySession` 只有选择/读取；G12 不同引用并行已测、同一引用双读取 transfer 隔离与 grant 回收未验证。

先加有意义的失败场景，再用最小设计修复（First Make it Work → Make it Right → Follow Practice）：

1. ~~G05~~ 已完成（7c4a975）。
2. ~~G06~~ 已完成（6828d6f）。
3. ~~G09~~ 已完成（import-legacy 菜单项，确认对话框 `confirmLegacyImport`）。
4. ~~G12~~ 已完成（9e4e9fc）。

可按 G05→G06→G09→G12 拆成小步提交。每个提交记下测试结果和剩余项。
W3 完成后按 IMPLEMENTATION 的 W4→W5→W6→W7 继续；依赖关系可拆分，但状态台账必须同步。

## 4. 进入环境：先观察，后修改

当前环境：Windows，仓库 `A:\better-woslicer`。默认执行工具实际为 PowerShell Core。
Git Bash 已安装，曾在沙箱启动失败、提权运行成功；不要每次强行切换，也不要猜用户新 shell 设置已生效。
`apply_patch` 已能直接编辑；偶发工具报告失败时先检查文件，不能假定完全未写。

逐项运行并读输出：

```powershell
Get-Location
$PSVersionTable
(Get-Process -Id $PID).Path
git status --short --branch
git log -5 --oneline
git diff --stat
node --version
npm --version
```

要求 Node.js 24。此前可用的本机缓存 Node 为：
`C:\Users\aya\AppData\Local\npm-cache\_npx\387698761821791d\node_modules\node\bin\node.exe`。
若当前 node 不是 24，先确认该路径存在/版本，再临时将它的 bin 目录前置 PATH；不要依赖旧环境隐式选中。
其他机器使用其已安装的 Node24，无需复制这条机器路径。清洁安装用 npm ci；若需清理旧 node_modules，先按下节移动。

原机器 Cargo target 曾使用 `A:\cargo.build`（仓库外）；写该缓存和 `.git` 可能需要工具沙箱提权。
使用工具已有审批机制，不绕过权限、不误把获授权的本地 commit 当作需要再向用户询问的产品决策。
偶发 `MXC launcher 0x8007000F` 先检查是否进程/文件已变更，再适度重试，不盲目重复 mutation。

启动新测试服务器前检查端口归属；此前用户自己的 Vite 在 4174，本项目 UI 测试在 4184，不能杀通用 node 进程。
端口与 PID 会变化，不把上次 PID 写死。只结束本次启动的进程及其子树。

## 5. 移动替代清理删除

禁止用 Remove-Item/rm/rmdir 等清理命令。本地旧构建、旧实现、临时目录移动到仓库 `.pending-delete/<timestamp>/`。
先检查绝对源/目标在仓库内、源不是仓库本身、目标不存在；单一 PowerShell 流程，不拼 shell 字符串跨壳删除。
下面示例仅在确需替换 `dist/app` 时执行；不要为了恢复任务机械移动输出。

```powershell
$repoRoot = (Resolve-Path -LiteralPath '.').Path.TrimEnd('\')
$sourcePath = (Resolve-Path -LiteralPath 'dist/app').Path
$archiveRoot = Join-Path $repoRoot ('.pending-delete/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$targetPath = [IO.Path]::GetFullPath((Join-Path $archiveRoot 'app'))
$repoPrefix = $repoRoot + '\'
if (-not $sourcePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not $targetPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $targetPath)) { throw 'Unsafe or occupied move target' }
New-Item -ItemType Directory -Path $archiveRoot | Out-Null
Move-Item -LiteralPath $sourcePath -Destination $targetPath
```

若路径涉及 junction/symlink，先核实解析目标仍在 workspace；不靠字符串前缀掩盖路径跳转。
已忽略 `.pending-delete/`、`test-artifacts/`、构建输出。之前的旧 app 输出位于
`.pending-delete/20261110-145859/app` 和 `.pending-delete/20261110-150439/app`；不需再动它们。
退出 tracked 旧源码时，移动后审查 Git diff 并在提交中保留迁移意图；不要 add 整个忽略归档。

## 6. 验证命令与边界

按改动选择检查；文档修改只需文档静态检查，不能宣称重新通过应用验证。
Vue/项目/恢复代码的常用命令（当前过渡脚本）：

```text
npm run typecheck:app
npm run test:components
npm run build:app
npm run test:app-ui
```

纯业务/旧兼容桥梁受影响再跑：

```text
npm run typecheck
npm test
npm run check:version
```

Rust 有改动时（本机依赖已缓存可用 --offline；不要用它掩盖缺依赖）：

```text
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets --all-features -- -D warnings
```

build:app 前移走需要替换的旧输出；typecheck/build 失败先诊断，不继续下游打包。
`test:app-ui` 用 dist/app、127.0.0.1:4184、Chromium 两个 profile、各 30 秒测试超时、新 context；其 server 不复用已有服务。
这是浏览器证据，不是原生 WebView UI、原生文件选择器或完整平台包验证。未来原生测试还必须有外层硬超时和进程树清理。

### 已有验证记录（此前执行，本轮未重跑）

本轮 W2a.1 验证（2026-11-10 JST，Node 24.22.2）：先运行新增用例得到预期的 3 failed / 7 passed；实现后 `npm run typecheck:app` 通过，`npm run test:components` 17 files / 147 passed。三个新增用例覆盖复杂文件精确保全与重解码、Buffer 子视图复制隔离、future 文件保全。未运行 build/UI profiles/归档、旧 lane 或 Rust：本轮仅编解码返回值增加原始字节，不改 UI、旧 lane、原生代码；未产出或宣称完整应用构建。测试输出在本轮工具日志，无新增持久测试产物。

| 范围 / 基准 | 记录 | 不能据此声称 |
|---|---|---|
| Vue/project Vitest + typecheck:app + build:app，W1 代码（618d445、5a40e7b） | 17 files / 144 passed（含 11 个新 W1 用例：写失败可见重试、旧 ACK 不清新修改、dispose 上抛、恢复四分类、坏/future/read-failed 保全与显式确认）；typecheck 通过；build:app 通过（bundle 大 chunk warning 与此前一致） | UI profiles、旧 lane、Rust 已验证 |
| Vue/project Vitest + typecheck:app + build:app，W2a.2 代码（5375e68） | 17 files / 150 passed（受限打开只读、原字节保存逐字节相等、受限操作拒绝、恢复受限只读且保存不可用、菜单可用性同规则）；typecheck 通过；build:app 通过 | UI profiles、旧 lane、Rust、真实 WebView 已验证 |
| Vue/project Vitest + typecheck:app + build:app，W2b+未知字段代码（fa1b652、53a5f57） | 17 files / 154 passed（两类 WOS 语义、原地导入可撤销、新建项目清空工作区、无音频导入不虚构媒体、未知字段披露与保存规范化、受限工程两入口均拒）；typecheck 通过；build:app 通过 | UI profiles、旧 lane、Rust、真实 WebView 已验证 |
| Vue/project Vitest，161fc52 对应代码 | 17 files / 134 passed | 所有计划缺口都已覆盖 |
| 旧 npm test，同次回归 | 224 passed / 4 skipped / 0 failed；缺 original oracle fixtures | 原版完整兼容已验证 |
| Vue UI production output，同次回归 | Chromium low 1280×720/DPR1、high 1920×1080/DPR2，各一个 workflow passed；真实 decode/开存/relink/取消/菜单/canvas | Vue Firefox 或 native Tauri 通过 |
| TS / Vue build | 新旧 typecheck、build:app 通过；bundle 大 chunk warning | 标准安装包已可交付 |
| Rust，df0d334 平台代码 | 10 tests、fmt、clippy all-targets/all-features -D warnings 通过 | Android/Linux/macOS 原生包通过 |

本机证据包括 `test-artifacts/project-regression.log`、`test-artifacts/app-ui/` 下的截图/trace；它们是忽略缓存。
构建 metadata 曾带提交前 dirty 信息；不要把旧 dist 当当前 HEAD 的干净发布产物。

未完成：native Tauri 两种 UI profile、真实原生对话框/剪贴板/BMSE 互通、Vue Firefox、标准目标平台包与归档、离线 WebView2 验证。
Android 明确不在本期验证范围；旧 Electron 默认构建/CI 仍在，不能将迁移称为完成。

## 7. 检查、提交、交接

每个可审查小步完成后：检查 `git diff --check`、准确 stage 本次文件、Conventional Commit 单行主题、再看 status。
保留不属于本任务的用户修改；无未授权 reset/checkout 覆盖。当前已授权随时本地 commit，不 push。

本轮文档验证（2026-11-10 JST）：7 份文档的本地 Markdown 链接与代码围栏检查通过；获批计划正文与原提取逐字一致并记录 SHA-256；`git diff --check` 通过。没有重跑应用测试。
W1 轮代码验证（同日）：`test:components` 17 files / 144 passed；`typecheck:app` 通过；`build:app` 通过。本轮未重跑 `test:app-ui`（App.vue 新增的确认对话框仅有逻辑级覆盖）、旧 lane `npm test`（改动不触及旧 lane，`src/renderer/session.ts` 为独立实现）与 Cargo（无 Rust 改动）；这些列入后续验收。
W2a.2 轮代码验证（同日）：`test:components` 17 files / 150 passed；`typecheck:app` 通过；`build:app` 通过。未重跑 `test:app-ui`、旧 lane `npm test`（不触及）与 Cargo（无 Rust 改动）。
G12 轮（同日）：cargo fmt/test --locked --offline（12 passed）/clippy all-targets all-features -D warnings 通过；`test:components` 17 files / 160 passed；typecheck:app 通过。`9e4e9fc`。注意：Cargo 前需先 `node scripts/tauri-build-info.mjs`（build.rs 会因过期 identity 拒绝构建）。
G09 轮（同日）：`test:components` 17 files / 160 passed；typecheck:app、build:app 通过。
G06 轮（同日）：`test:components` 17 files / 158 passed；typecheck:app、build:app 通过。`6828d6f`。
G05 轮（同日）：`test:components` 17 files / 156 passed；typecheck:app 通过。`7c4a975`。
W2b 与未知字段轮（同日）：`test:components` 17 files / 154 passed；`typecheck:app`、`build:app` 通过；每次提交前 `git diff --check` 通过。同样未重跑 UI profiles、旧 lane 与 Cargo（无 Rust 改动）。
以后更新此检查点必须写明：

- 当前 HEAD、分支、未提交文件及归属。
- 刚完成的 W/G 项和可观察行为；没有完成的事项仍保留。
- 执行过的检查、结果、跳过原因、测试产物位置。
- 下一项具体动作、入口文件、预期失败用例，不只写“继续完善”。
- 只在有新约束时修改决定 D；解释其用户/证据来源。

可以直接给下一工具的续做指令：

> 先读 AGENTS.md 和 docs/migration/RESUME.md，对照 Git 状态；从 W2a.2 接续受限打开与保全保存，复用 W2a.1 的 sourceBytes，先加 workspace 失败用例。
> 原生业务菜单已确定迁入 Web UI；多轨只预留 schema；不修复将退出的旧打包轮子。
> 清理用移动至 .pending-delete，完成小步检查后本地 commit，并更新恢复文档。
