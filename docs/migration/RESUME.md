# 从这里恢复 Vue / Tauri 移植

最后核对：2026-11-10 JST。本文是跨聊天、工具、机器和额度恢复入口，不依赖任何会话服务。
仓库相对路径可直接使用；下方 Windows 绝对路径仅是这次环境记录。

## 1. 当前任务与检查点

- 当前用户要求：重新挖掘第三次 session，回填详细实施计划，确保下次直接恢复；本轮是文档整理，没有声称完成剩余移植代码。
- 工作分支：`feature/tauri`。应用代码检查点 `161fc52`；随后文档检查点 `e959a97`。本轮文档提交用 `git log -3 --oneline` 定位，避免自引用 commit hash。
- 恢复时先核对 HEAD/diff；本文记录的是上述检查点，不覆盖后来已经完成的工作。
- 本轮开始工作树干净。产物为入口文档、获批原文、时序证据、实施差异台账、格式说明和 AGENTS 恢复入口；没有应用源码改动。
- **下一项代码任务：W1 恢复写可靠性。** 不要先回去美化原生菜单、重构旧打包工具或实现多轨混音。

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

## 3. W1 的直接起手步骤

先读 `src/workspace/persistence.ts`、`session.ts`、`workspace.ts` 及 `tests/app/workspace.test.ts`、`workspace-fixture.ts`。
编辑前加载当前工具可用的 TypeScript/Vue skill；Rust 改动再读 Rust skill。本轮整理不是要求重跑 smell 审计。

当前根因：flush 在 writeSession 完成前把 dirty 清掉，定时器/dispose 吞错误；parseEditorSession 把坏/未来记录和 absent 混为 null。
当前串行写和 reset 防复活已有测试，保留其行为，不推倒重写。

先加有意义的失败场景，再用最小设计修复（First Make it Work → Make it Right → Follow Practice）：

1. 项目编辑后自动写失败：显示恢复保存失败；待写状态保留。用户重试即使没有新编辑也能写出正确快照。
2. 写 A 未完成期间编辑为 B：A 成功/失败都不能把 B 误认成已持久化；后续写 B 有序，不写回旧快照。
3. 读取 absent、corrupt/invalid、future、host read failure 的结果可区分。非 absent 原输入保留，确认替换前不允许自动恢复写覆盖它。
4. 工作区恢复/显式开始新项目/取消替换各有明确状态；错误可见但不妨碍应用离线启动。不要为了“启动成功”把错误吞掉。
5. close/reset 与 pending 写交错不复活已关闭内容；clear 失败可见；dispose 不遗留未处理 rejection 或静默把失败当成功。
6. 不把恢复写失败等同于项目已经保存；项目 dirty 和恢复 pending 是两个状态。

可先提交 W1a（写 ACK/失败/重试），再 W1b（恢复结果/保全/确认）。每个提交记下测试结果和剩余项。
W1 完成后按 IMPLEMENTATION 的 W2→W3→W4→W5→W6→W7 继续；依赖关系可拆分，但状态台账必须同步。

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

| 范围 / 基准 | 记录 | 不能据此声称 |
|---|---|---|
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
以后更新此检查点必须写明：

- 当前 HEAD、分支、未提交文件及归属。
- 刚完成的 W/G 项和可观察行为；没有完成的事项仍保留。
- 执行过的检查、结果、跳过原因、测试产物位置。
- 下一项具体动作、入口文件、预期失败用例，不只写“继续完善”。
- 只在有新约束时修改决定 D；解释其用户/证据来源。

可以直接给下一工具的续做指令：

> 先读 AGENTS.md 和 docs/migration/RESUME.md，对照 Git 状态；按 IMPLEMENTATION.md 的 W1 接续恢复可靠性。
> 原生业务菜单已确定迁入 Web UI；多轨只预留 schema；不修复将退出的旧打包轮子。
> 清理用移动至 .pending-delete，完成小步检查后本地 commit，并更新恢复文档。
