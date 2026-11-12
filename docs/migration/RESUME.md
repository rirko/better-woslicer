# 从这里恢复 Vue / Tauri 移植

2026-11-11 工具链批次（覆盖所有旧 Node/构建模式要求）：**统一 Node 26.x、本机默认 debug、CI 仅 release 已落地。** `.node-version` 供 CI 共用，npm engines=26.x、`@types/node`=26.6.6；本机 `build`/`build:app`/`build:app:tauri`/`package`/`tauri -- build` 与 IPC 探针默认 debug，显式 `--release` 或 `WOSLICER_BUILD_PROFILE=release` 才走 release。前端 debug 跳过压缩，release 压缩 JS/CSS 且无 sourcemap；Cargo release 使用 opt-level=z、LTO、单 codegen unit、strip symbols，保留 unwind 以复用 test/build 依赖。CI tests/Clippy 统一 release+all-features，先生成嵌入资源，打包复用前端并关闭重复 hook。规则、四语 README、CI 文档与活跃计划已同步，旧 Node 24 测试记录只保留为历史证据。

本批验证（Windows x64，Node 26.12.1 / npm 11.20.0）：`npm ci` 干净安装、lint/fmt/typecheck、7 条工具链测试、202 组件与 180 core 测试通过（4 oracle 缺 fixture 跳过）；Rust fmt、debug/release 各 13 tests 与 release Clippy 全过；Web 两种模式 build、各自 low/high UI 2/2、ZIP 逐文件 SHA-256 往返校验通过（release 确认无 map）。Windows 两种模式 MSI/NSIS 均重建成功且 MSI ProductVersion=1.0.0：debug 6.39/4.76 MiB，release 2.43/1.80 MiB。默认 debug 与显式 release IPC 探针均通过；CI 的 release 环境及跳过重复 frontend hook 路径已用本机 Tauri 实际构建验证。actionlint、YAML 解析与 24 段 Bash 语法检查通过。日志位于 `test-artifacts/node26-*`。**托管 CI、其他 OS/arch 和 native UI 双 profile 仍未验证**；本批没有 push/tag/发布。下一卡仍为 R3，本批不改界面重构排期。

2026-11-11 续做批次（T0+R0+T1 已提交）：**T0 lint/fmt 工具链落地 `8e601e6`**——ESLint 10 flat config（typed+Vue）+ Oxfmt 0.78.0 + 命令合同（lint/lint:fix/fmt/fmt:check/check:quality），lint 基线 301 problems/45 files、正反例 fixture、140 文件格式化两遍哈希一致、`npm ci` 重建验证；未装 hook/未动 CI（T3 范围）。**R0 视觉/行为基线落地 `c4b4970`**——typecheck/202 组件/build/双 profile UI/10 场景基线截图+computed style 全过（`test-artifacts/ui-baseline/`、`test-artifacts/lint-baseline/`），进度见 [UI_READABILITY_PROGRESS.md](../refactoring/UI_READABILITY_PROGRESS.md) 与 [LINT_FORMAT_PROGRESS.md](../refactoring/LINT_FORMAT_PROGRESS.md)。发现并已记录：web CSP 拦 build-info（web lane About body 为空、状态栏 Load failed 属预期）；Playwright `toBeVisible` 在对话框 opacity=0 即通过（spec 用 expect.poll 等 opacity 1）；Chromium fullPage 截图丢 fixed 对话框（用视口截图）。**T1 格式基线完成（5 个格式专用提交 `4cc9fd9`/`b204047`/`4c660df`/`914a3e2`/`33c5358`）**——fmt:check 全绿、二遍 fmt 零 diff、lint 计数 301 不变、202 组件/typecheck/build 复验过、UI 22 产物重采对照（10 个逐字节同、12 个仅 ≤0.28% 像素抖动）；`ui-baseline/` 已轮换为 post-T1 基线，pre-T1 归档保留。**下一卡：R1a–R1d**（审查格式化输出+少量语义分组），随后 T2 lint 清理（301 条）与 R2–R10。

2026-11-11 续做批次 2（R1 全部完成）：**R1a `fe90ca3`（app shell：逗号声明拆分+区域注释）、R1b `31a7162`（面板八文件：+62 纯注释/空行）、R1c `723f584`（播放/时间轴/校准：+94，唯一语义面=声明拆三条）、R1d `d80c9e9`（bmhelper：+52 纯插入）**——每卡均协调者独立复核（非注释行过滤器 + fmt:check 0 + lint 恰好 301 + 定向组件测试），R1 合并验证 typecheck/202 组件/build/双 profile 2/2 全过，视觉对照 10/22 逐字节同、12 个仅 ≤0.33% 像素刻度线/AA 抖动（low/main 1717px 差异计数与 T1 时一致=运行间确定性 AA 差）。`ui-baseline/` 已轮换为 post-R1 基线（pre-r1 归档保留）。执行子代理教训：R1a 首个代理在验证长命令阶段无输出超时，后续代理经"输出重定向到 test-artifacts 日志再读退出码"约束后正常。**下一卡：T2 lint 清理**（301 条，tests 271/生产 30 分开派卡；约束见 LINT_FORMAT_PLAN §2——不得为过 lint 滥加 void），或并行推进 R2（删 platform prop，前置 R1a 已满足）。

2026-11-11 续做批次 3（T2 完成，全仓 lint 0）：**301→0，七个提交**——配置 `e31e56b`（no-floating-promises 豁免 vitest/node:test 框架自消费调用 + no-unused-vars `^_`；**不豁免回调内部**）→ 生产 `59532e6`（16 项，含 `tsconfig.lint.shims.d.ts` 供纯 tsc lint 解析 .vue；BMHelperPanel defaultSort 具名常量——R9 重叠已记录）→ browser.ts `49da1e2`（守卫+require-await 等价改造，逐方法 throw 语义分析；reopenFile 保 rejection 供 `.rejects` 测试）→ 测试四卡 `0adfad0`/`853560e`/`80a664c`/`b743bc3`（34+17+13+9；satisfies 替代类型注解消 unbound-method；`expect.any(String) as string` 钉 matcher 类型）。终验全链绿：lint 0、fmt 0、typecheck 0、npm test（202+180/4 skipped）、build、双 profile UI 2/2、10 场景重采（14–15/22 逐字节同，余为既证抖动）。**失误记录**：T2 视觉对照先覆盖后归档，pre-T2 直接对照件丢失（补救链与教训见 LINT_FORMAT_PROGRESS T2 节；**以后归档必须在覆盖前**）。**下一卡：T3 hook/CI 上线**（前置已满足：隔离临时 repo 验证 pre-commit 正反例+部分暂存恢复+CI 命令顺序调整，见 LINT_FORMAT_PLAN §3/§4）或 R2。

2026-11-11 续做批次 4（R2 + T3 完成，lint 方案 T0–T3 全部落地）：**R2 `466fdfd`**（删 WorkspacePanels 虚假 platform prop，F-9 resolved；lint/fmt/typecheck 0、app-controls+app-root 9 过）。**T3 hook `7c8a562` + CI `c24096e`**：husky 9.1.7 + lint-staged 16.4.0；`prepare`=husky、`lint:staged`=`lint-staged --concurrent false`；`.husky/pre-commit` 单行；`lint-staged.config.mjs` 三组（代码 eslint+oxfmt check / 其他文本 oxfmt check / 工具配置→`scripts/check-staged-quality.mjs` 全量 lint+fmt:check，**读工作树**）；CI web job 在 npm ci 后加 lint+fmt:check；CI.md+README×4 同步。验证：隔离临时 repo **13/13 场景**（正例/格式/TS/Vue 反例/部分暂存恢复/中文空格名/删除/无匹配/配置全量/无依赖明确失败不下载）+ 本仓两次真实提交现场通过（29.2s/13.8s）。**未验证**：托管 CI 首跑（需 push 授权）、Linux hook。**注意**：`R:\TEMP\woslicer-t3-*` 临时 repo 含指向本仓 node_modules 的 junction，处置须先解除 junction，禁止递归删除/跨盘移动。**从现在起每次本地提交都会跑 pre-commit**（配置类文件触发全量检查约 30s）。**下一卡：R3**（布局样式归位，协调者先确认级联——R0 computed-styles 为证据）→ R4–R10 按方案 §3 依赖顺序。

2026-11-11 恢复批次（覆盖下文旧 CI/离线安装要求）：设计书先独立提交为 `a6728d4`。迁移后 CI 恢复 Web 与 Windows x64 必过、Windows ARM64/Linux x64/ARM64 可选；Rust cache 固定官方 v2.9.3 SHA；tag 直接公开 prerelease，按配置恢复 Pages。详见 [CI.md](../CI.md)。托管首跑与 native UI 双 profile 仍待验证，未执行 push/tag/发布。

用户明确：只有应用内部要离线；外部、安装器、依赖和系统运行时独立联网不属于应用责任。保持 Tauri 默认 WebView 安装行为，不捆绑运行时、不禁止下载、不支持缺少 WebView 引擎的系统。离线 WebView 分发不再是验收项。

恢复批次本地验证：Node 24 typecheck、组件 202/core 180（4 oracle 因缺 fixture 跳过）、Web build、独立 low/high UI 各 1/1、Web ZIP 内容往返校验均通过；actionlint 与 22 段 Bash 语法检查通过。Windows MSI 版本查询逻辑用现存 1.0.0 产物只读验证，未重新构建桌面包。UI 首次在沙箱内启动/清理受阻，清理本次进程树后在沙箱外通过；超时包装器已修正为清理失败也会报告超时。紧急备份标签 `backup/truncated-ci-batch-20261111` 保留；未恢复其复杂自写产物/发布脚本。

最后核对：2026-11-11 JST（T0+R0 续做批次后更新）。本文是跨聊天、工具、机器和额度恢复入口，不依赖任何会话服务。
仓库相对路径可直接使用；下方 Windows 绝对路径仅是这次环境记录。

## 1. 当前任务与检查点

- 2026-11-11 **T0 完成（`8e601e6`，Node 24.22.2 实测）**：devDeps eslint 10.14.0 / @eslint/js 10.0.1 / typescript-eslint 8.72.2 / eslint-plugin-vue 10.12.1 / eslint-config-prettier 10.1.8 / oxfmt 0.78.0（精确钉版）/ globals 16.5.0；`eslint.config.mjs`（typed 块显式 map 限定 TS 家族——8.72 预设默认作用于全部文件会伤 JS；`.vue` 顶层 vue parser + script 经 parserOptions.parser 获 typed）+ `tsconfig.lint.json`（显式含组件测试/根 .mts——现有 tsconfig 不覆盖它们）+ `.oxfmtrc.json`（100 列/单引号/逐行属性/关 sortPackageJson——它默认开）。试跑证据全部在 LINT_FORMAT_PROGRESS.md：lint 301 problems（tests 271/生产 src 30/SFC 1，清单 `test-artifacts/lint-baseline/eslint-baseline.json`）、fixture 正反例、oxfmt 幂等（140 文件两遍哈希同）、真实树 121 文件待格式化（`fmt-baseline.txt`=T1 输入，未格式化）、npm ci 重建一致。
- 2026-11-11 **R0 完成（`c4b4970`）**：`tests/app/ui-readability.spec.ts`（5 场景，`WOSLICER_UI_BASELINE` 门控——默认 `test:app-ui` 不跑它们，保持 30s/profile 预算）+ `scripts/verify-ui-readability.mjs`（场景×profile 独立进程+30s watchdog+进程树清理）。基线：typecheck/202 组件/build:app/test:app-ui 双 profile/10 场景截图+computed-styles.json 全过；`.timeline` min-height 160px、`.workspace` grid 896/384（high 1344/576）、`.side-panel` border-left 1px+overflow auto。四条现场发现已写进 UI_READABILITY_PROGRESS.md（CSP 拦 identity、对话框 opacity 等待、fullPage 丢 fixed、Light 主题）。
- 2026-11-11 **重构方案追加 lint/fmt 与 pre-commit**：见 [LINT_FORMAT_PLAN.md](../refactoring/LINT_FORMAT_PLAN.md)。Oxfmt + ESLint flat config（TS 类型感知/Vue template）+ Husky/lint-staged；T0 工具配置 → T1 格式基线 → T2 lint 清理 → T3 hook/CI 上线，之后继续局部重构。只检查、不在 hook 自动改写；T0 已落地（见上条），**T1 格式基线未开始**。

- 2026-11-11 **界面等价重构方案已编写，尚未实施**：用户要求结合已有 smell-check 与人工可读性问题，为 flash 级 agent 编写可执行小任务。入口为 [UI_READABILITY_PLAN.md](../refactoring/UI_READABILITY_PLAN.md)，核对基准 HEAD `44a8192`、最新报告 `.smell-check/20261110-180802Z`（57 active / 5 dismissed）。先 R0 固定行为/视觉基线，再按卡实施；本轮仅文档，不表示发现已修复或测试通过。F-7 关闭流程锁范围与其余确认不同，禁止机械五合一；Node 现场为 26；当时要求切回 24，已被当前 Node 26 决定覆盖。W6 原生验证等剩余项继续保留。

- 2026-11-10 本轮：**W1 恢复写可靠性已完成。** W1a `618d445`（写 ACK/失败可见/重试/dispose 上抛）、W1b `5a40e7b`（恢复结果区分 absent/restored/invalid/future/read-failed，坏/future/read-failed 原输入保留，恢复写暂停，打开内容需显式确认丢弃，`reset` 显式清档）。
- 2026-11-10 续做：**W2a.2 受限打开与保全保存已完成（`5375e68`）**：复杂布局只读打开、editor 层单点拦截、保存原字节、恢复还原保持只读且保存明确不可用。
- 2026-11-10 W5 起步：**G10 部分完成（本次提交）**：`menuCommandEnabled` 成为菜单禁用与命令执行的同一规则函数（穷举 switch），规则表测试 33 例覆盖全部 18 个菜单命令的状态矩阵（空/带源/受限/带历史）；`MENU_COMMANDS` 导出供测试。W5 剩余：模态/busy 绕过核对、手势跨入口验证、生命周期释放清单、undo 容量测量。
- 2026-11-10 W6 产物校验（本机 Windows 真实证据）：①启动冒烟——直接运行构建的 woslicer-dx.exe，主窗口 "woslicer-dx" 出现且 responding=true，进程树清理干净；②MSI 元数据经 WindowsInstaller COM 查询：ProductName=woslicer-dx、ProductVersion=0.3.0（root version 贯通链路验证）、Manufacturer=woslicer；③MSI 载荷 11,128,320 字节与构建的 woslicer-dx.exe 精确一致。归档深度校验（本批范围）完成；抽取临时目录按规则移入 .pending-delete。
- 2026-11-10 W6 显式 WSL 冒烟（本机证据，按第 9 条约束显式调用）：WSL 内 webkit2gtk-4.1/Rust 1.99 在位；`cargo check --locked --all-features` 通过（17s，注意 WSL 侧也要先跑 `node scripts/tauri-build-info.mjs`，且 Cargo.toml 需 --manifest-path）；`cargo test --locked` 12/12 通过（CARGO_TARGET_DIR=/tmp/woslicer-wsl-target 独立缓存）。Linux 编译+测试证据落地；native UI 双 profile 仍待 tauri-driver 级工具。
- 2026-11-11 ACL 修复（用户运行时报 "command begin_read not allowed by ACL"）：根因是 build.rs 的 `AppManifest.commands` 显式清单没有 begin_read——tauri ACL 生成本地命令权限，capability 与生成清单都要显式列出，编译/旧测试均不会发现。修复：build.rs 清单 + capabilities/main.json 各加 begin_read；新增 **三链一致性测试**（invoke_handler ↔ build.rs 清单 ↔ 生成 allow-* ↔ capability，kebab/snake 归一化），13 Rust 测试全绿；重打 MSI/NSIS + 启动冒烟通过。**请重新安装新包后再试音频打开**（旧安装包内 ACL 仍是缺 granted 的版本）。
- 2026-11-11 **Electron 生态全面退场 + 机器路径清除（用户指令）**：①移出 src/main、src/renderer、src/web、旧打包/发布/UI 脚本 15 个、playwright.config.ts、tsconfig.main/renderer、5 个 Electron 绑定测试（build-info/ipc-security/keys/menu/timebase）→ .pending-delete/20261111-012400-820/electron-lane；tests/web（旧 web spec）另移。②17 个 core 测试改由新 tsconfig.tests.json 编译（node --test dist/tests；test 脚本先清 dist/tests 防陈旧产物假绿）；i18n.test 的 data-i18n 旧 HTML 测试删除、menu/dialog lockstep 改读 generated。③package.json：13 个旧脚本删除，electron/esbuild/7zip-bin/html-minifier-terser/resedit 依赖移除；typecheck = vue-tsc app + tsc tests。④机器路径：tauri-ipc-probe 改为 CARGO_TARGET_DIR/src-tauri/target 解析 + 非 Windows 优雅跳过；活动代码零机器绝对路径（docs/migration 的环境记录按其自身定位保留）。⑤static 服务器恢复为 scripts/serve-static.mjs（playwright.app.config 引用）。⑥文案：README×4（命令区+源码构建）、VERSIONING 重写（Tauri 链）、NOTICE 依赖句、package description、src/core 注释（decode/language/markers/slices）、AGENTS 三行（Tauri 隔离/版本/UI 测试表述）、About 文案 4 语言去 Electron、死键 menu.aboutDetail 删除。⑦CI verify job 增加 playwright chromium + test:app-ui（跨平台 web 画面）。验证：组件 202 + core 180/4 skipped + cargo 13 + fmt/clippy + build/package（MSI/NSIS 1.0.0）+ UI 双 profile 2/2 + 探针通过。许可证署名（woslicer-electron contributors）按 preserve 原则保留。
- 2026-11-11 **版本 1.0.0 + identifier 定稿（用户决定）**：root version 1.0.0（`npm version` 流程：双语 changelog 1.0.0 段先行，check:version 通过；changelog 仅 UX 断言，Fixed 两项以旧 lane 静默吞错的源码为据）；identifier → io.github.rirko.woslicer-dx（应用数据目录更换：本机已迁移 file-grants 与窗口状态；旧存档在用户关闭流程中已清空，无需迁移）；MSI/NSIS 重产为 woslicer-dx_1.0.0_*（COM 元数据验证 ProductVersion=1.0.0）；`test:tauri-ipc` 探针路径同步；web 双 profile 2/2、组件+旧 lane 全绿。tauri-ipc-probe 需在新目录下重新打开一次音频以生成 grant。
- 2026-11-11 **音量滑杆修复**：Element Plus 在单向绑定下 change 事件重发**旧 modelValue**（use-slide.mjs emitChange 实证），原 `@change`-only 提交写回旧值导致滑杆弹回"无法调整音量"。修复：本地 drag ref 接 update:model-value（拖动预览），change 提交预览目标（一次拖动一个事务）；音量/Cue 双滑杆同修；单测钉住真实发射序列（update(50)+change(旧值)→store=50 的目标值）。真机 CDP 点击验证：值改至 19 并持久，无异常。G07 遗留的"滑杆手势草稿化"打磨由本修复覆盖。
- 2026-11-11 **IPC 传输修复（b3c98a7）+ 双发行/画面测试约束落地**。根因链：`src/app/index.html` 的 CSP meta `connect-src 'none'`（web 版严格策略）对 Tauri 版同样生效 → `fetch('http://ipc.localhost')` 被 CSP 拦截（CDP 实测 "Failed to fetch" + console 警告）→ tauri `customProtocolIpcFailed` 永久回退 postMessage → `Response::new(bytes)` Raw 响应被 JSON 序列化为数字数组 → 前端 `instanceof ArrayBuffer` 失败报 "incomplete binary file transfer"。修复：vite 按 `WOSLICER_TAURI_FRONTEND` 出双变体（`dist/app` web 严格 CSP；`dist/app-tauri` connect-src 放行 'self' ipc: http://ipc.localhost），`tauri.conf.frontendDist` 指向 app-tauri，`build:app:tauri`/`dev:tauri`/`beforeDevCommand` 就绪（runner scripts/build-app-frontend.mjs，Windows cmd 无 env 前缀语法）。验证：CDP 探针 raw chunk = ArrayBuffer(1MiB)、零回退警告；固化 `test:tauri-ipc`（scripts/tauri-ipc-probe.mjs）；web 版 `test:app-ui` 双 profile 2/2；组件 202。**用户需重装新包后再试音频打开**。
- 2026-11-11 MSRV/tauri 升级（用户决定：MSRV 跟随最新 stable）：rust-version 1.85→1.99；tauri 家族 crate 升 2.12.5（build 2.7.4、window-state 2.5.0、wry 0.57.2）；npm api/cli 回对齐 2.12。验证：Windows cargo test 12/12 + fmt/clippy、WSL Linux cargo test 12/12、双链 202 组件 + 旧 lane、真实 MSI(4.78MiB)/NSIS(3.80MiB) 重产。此前「勿升 2.12」备注已被本决定取代。
- 2026-11-10 W6 主切换（`886e388`）：`dev`/`build`/`package`/`typecheck`/`test` 为产品主入口（typecheck/test 双链）；旧 lane 显式 `:*electron`；bundle.active=true + 图标集；**真实产物本地实测通过**：`npm run package` 产出 woslicer-dx_0.3.0_x64_en-US.msi（4.9MB）与 -setup.exe（3.9MB）（A:cargo.buildeleaseundle，WiX/NSIS 构建期下载）；tauri npm↔crate minor 对齐（2026-11-11 起为 2.12，MSRV 跟随最新 stable 政策见下条）；build.yml 重写为真实 Ubuntu verify + windows/linux 打包（无 WSL、无 cache action——固定 SHA 不可凭记忆写，暂缓并记录）；release.yml+旧矩阵退场至 .pending-delete；docs/CI.md 重写。
- 2026-11-10 W4 起步：**G08 已完成（本次提交，W4 收官）**：BMHelper store `bindEditor` 后每次编辑以一个事务写通 `bmhelper` payload（undo/dirty 参与、上限预检）；projectId 切换经 watcher 自动重载/清空工作副本；`saveBmhProject` 版本守卫使保存期新编辑保持 dirty；面板改用注入 workspace（platform 稳定），面板测试迁移到 provide。已知边界：同一 projectId 的重恢复不会触发重载（已记录接受）。
- 2026-11-10 W4 起步：**G07 已完成（本次提交）**：volume/cue/rate/cueMode/rms/bands 从 session ref 改为 document.global 可写投影（一次意图一次事务、参与 undo/dirty、limited 下只读静默）；`masterAmp` 路由 = global master 增益（masterMuted 置 0；track 投影为 schema 预留，非中性 track 仍判受限）；视图有效值 = track.views 覆盖 ?? global；会话快照不再携带已迁移键，旧归档 options 迁移进 global；音量滑杆改 change 提交（一次拖动一个事务）。旧断言「监控不入文档历史」按获批模型反转。
- 2026-11-10 W4 起步：**G11 已完成（`de46b1f`）**：cue 交叉重置监听从整个 docRevision 收窄到 markers/bpm/shift 值键；无关文档编辑（输出配方/噪声门）不再吞掉越过的 cue；时间基准变化仍恰好重锚一次；行为由 `timeline-playback.test.ts` 的 AudioContext 假体证明（含 flush 时序注意：编辑后需微任务 flush 才能观察 watch）。
- 2026-11-10 W3 起步：**G12 已完成（`9e4e9fc`）**：reader 改为按独立 transfer ID（新增 `begin_read` 命令；grant/reopen 不再插 reader；chunk/close 按 transfer 定位），同一引用双读取拥有独立句柄与 seek 位，先结束的 transfer 不再影响后者；16 MiB 检查移到开 reader 之前；grant 生命周期有测试（同路径复用引用、1024 上限拒绝新 grant 且既有可 reopen）。Rust fmt/test(12)/clippy -D warnings 全过；前端 adapter mock 已迁移并全绿。
- 2026-11-10 W3 起步：**G09 已完成（本次提交）**：`Platform.importLegacySession` 进入契约（browser/tauri 各自接线）；`convertLegacySession` 纯转换信封（`{version,session}` 内层走既有 legacy 解析）；`importLegacyRecovery` 命令+菜单项：读取→摘要预览（名称/BPM/偏移/切点数）→App 对话框确认→整体替换并恢复；legacy `lastFile.path` 仅 hint，归档 lastFile 为 null，reopen 不触发；拒绝/非 legacy 文件不动工作区。
- 2026-11-10 W3 起步：**G06 已完成（`6828d6f`）**：relink 不匹配改为可选采纳——`confirmRelinkDifference` 回调（App.vue 对话框，4 语言），确认后以一次可撤销事务更新媒体元数据（名称/格式/字节/采样率/声道/帧数/完整性）与 clip 帧数，mediaId 稳定；拒绝或未接线保持硬拒绝且不改动；对话框期间并发编辑经 revision 守卫作废。
- 2026-11-10 W3 起步：**G05 已完成（`7c4a975`）**：音频绑定改为 `editor.lastFile`（独立于 decoded source 生命周期）——解码失败/取消不清绑定，归档持续携带 lastFile；restore 先种绑定再尝试 reopen，失败后下次归档仍保留；reopen 成功不重置 projectId/媒体/dirty；`reset`/打开工程/`newProjectFromWos` 清绑定，reference 为 null 的加载清除绑定。
- 2026-11-10 续做：**W2 全部完成**。W2b `fa1b652`：WOS 拆为 `importWosSettings`（原地单事务、保留身份/媒体/输出、一步撤销、无音频不虚构媒体）与 `newProjectFromWos`（整体替换、走替换确认、清空 source）；`savedWos` 文案明确仅时序与切点。`53a5f57`：`parseProject.unknownFields` 收集未知字段路径，可编辑工程打开时 `projectUnknownFields` 披露“保存不保留”；future 版本打开前抛错不落盘（原文件即保全，处置已记入 PROJECT_FORMAT）。
- 工作分支：`feature/tauri`。本轮起点 HEAD `777cf0e`；W2a.1 检查点提交位于其后（用 `git log --oneline -3` 定位）。
- 恢复时先核对 HEAD/diff；本文记录的是上述检查点，不覆盖后来已经完成的工作。
- 本轮改动归属：codec/schema、project 测试及三份迁移/格式文档，全部属于 W2a.1；无用户遗留修改。提交后核对工作树干净。
- **W2–W5 全部完成；W6 主切换落地**。W6 剩余（按序）：①CI 首跑验证（需 push 分支触发，**不 push 需用户明示**）；②native UI 双 profile（tauri-driver 工具链，仍未做；桌面 IPC 传输已有 test:tauri-ipc 探针，web 画面基线 test:app-ui 已就位——新画面测试按 IMPLEMENTATION 第 6 节扩展）；③归档深度校验已有本机证据；Rust cache 已配置，待 CI 首跑核验。不要先回去美化原生菜单、重构旧打包工具或实现多轨混音。

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
9. 本机 WSL 已可运行 Tauri：仅限本机、必须**显式调用**（不写入默认脚本、不在他机隐式启动 WSL）；CI 的 Linux 验证交给真实 Ubuntu runner，不用 WSL；WSL 证据标注为"本机验证"。详见 IMPLEMENTATION 第 6 节。

## 3. W6 的直接起手步骤

已落地：主入口/CI/bundle 配置/真实 Windows 产物（见第 1 节 W6 主切换条目）。剩余项按第 1 节顺序执行；native UI 双 profile 起手读 `src-tauri/`（tauri-driver/WebView2 能力）与 `playwright.app.config.mts`（web 侧 profile 参照），WSL 路径仅本机显式。旧 Electron lane 已全部退场（见 2026-11-11 Electron 退场条目）。
Rust/打包改动加载 Rust skill；跑 Cargo 前先 `node scripts/tauri-build-info.mjs`。

当前现状：Vue/Tauri 已是唯一链路（旧 Electron 生态 2026-11-11 全部退场）；bundle/CI/真实产物均已落地；native Tauri 双 profile、恢复后托管 CI 首跑未做。本机 WSL 可显式跑 Tauri 冒烟（仅本机、显式调用；CI 用真实 Ubuntu，见第 4/6 节）。

先加有意义的失败场景，再用最小设计修复（First Make it Work → Make it Right → Follow Practice）：

1. release.yml 已恢复为 v* tag 触发，复用迁移后构建并直接公开 prerelease；Pages 按仓库变量启用。旧 draft 流程不再适用。
2. dev/typecheck/test 已切（本批）；剩余 build/package 主入口与旧脚本退场：与 CI 重写同批做（scripts 更名会断 build.yml 引用，必须一次成批）。
3. Tauri 常规目标产物（本机平台先做），bundle 配置按 D10 裁剪；产物做归档校验。
4. CI：Node26 + npm ci + Rust locked + 目标系统依赖 + 固定 SHA 的维护中 Rust cache action；构建、Rust 测试与 Clippy 均用 release；工作流待分支 push 验证；发布按 docs/CI.md 的 tag 流程。
5. native UI 双 profile（1280×720/DPR1、1920×1080/DPR2）用 Tauri 驱动验证；本机 WSL 路径可作为中间证据（标注"本机 WSL"），标准验收以真实平台包为准。

W6 完成后进入 W7（历史 smell findings 处置、许可证、README×4、changelog×2）。

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

要求 Node.js **26.x**，版本源为 `.node-version`（CI 共用），npm engines 与 Node 类型包同步。当前本机为 Node 26.12.1 / npm 11.20.0；不再使用旧 Node 24 缓存或切换指令。清洁安装用 npm ci；若需清理旧 node_modules，先按下节移动。

本机 build/package/test 默认 debug，显式 `--release` 才用 release；也可设置 `WOSLICER_BUILD_PROFILE`。Cargo 本地测试保持默认 test profile；CI 使用 release 并与打包共享优化配置。入口与例子见 [CI.md](../CI.md)。下文旧版本测试记录仅为历史证据。

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

未完成：native Tauri 两种 UI profile、真实原生对话框/剪贴板/BMSE 互通、Vue Firefox、标准目标平台包与归档。
Android 明确不在本期验证范围；native Tauri UI 验证未完成前，不将迁移称为完成。

## 7. 检查、提交、交接

每个可审查小步完成后：检查 `git diff --check`、准确 stage 本次文件、Conventional Commit 单行主题、再看 status。
保留不属于本任务的用户修改；无未授权 reset/checkout 覆盖。当前已授权随时本地 commit，不 push。

本轮文档验证（2026-11-10 JST）：7 份文档的本地 Markdown 链接与代码围栏检查通过；获批计划正文与原提取逐字一致并记录 SHA-256；`git diff --check` 通过。没有重跑应用测试。
W1 轮代码验证（同日）：`test:components` 17 files / 144 passed；`typecheck:app` 通过；`build:app` 通过。本轮未重跑 `test:app-ui`（App.vue 新增的确认对话框仅有逻辑级覆盖）、旧 lane `npm test`（改动不触及旧 lane，`src/renderer/session.ts` 为独立实现）与 Cargo（无 Rust 改动）；这些列入后续验收。
W2a.2 轮代码验证（同日）：`test:components` 17 files / 150 passed；`typecheck:app` 通过；`build:app` 通过。未重跑 `test:app-ui`、旧 lane `npm test`（不触及）与 Cargo（无 Rust 改动）。
ACL 修复批（2026-11-11）：见第 1 节 ACL 修复条目；cargo 13 测试/fmt/clippy、npm run package、启动冒烟均过。
滑杆修复批（2026-11-11）：真机 CDP 点击 20%→值 19 持久保持；组件 202 全绿。
IPC 修复批（2026-11-11）：见第 1 节 IPC 传输修复条目；双发行与画面测试约束已写入 IMPLEMENTATION 第 6 节。
W6 升级批（2026-11-11）：见第 1 节 MSRV/tauri 升级条目；全部验证通过后本批提交。
W6 产物校验批（同日）：原生启动冒烟 + MSI COM 元数据 + 载荷尺寸比对全过（临时目录已移入 .pending-delete）。
W6 WSL 批（同日）：显式 wsl bash -lc 路径，Linux check+test 全过（标注"本机 WSL"）；CI 仍以真实 Ubuntu runner 为准。
W6 主切换批（同日）：npm run build（新链）+ npm test（202 组件 + 224 旧）+ cargo fmt/clippy/test --offline 全过；npm run package 实测 MSI/NSIS 产物；tauri info 环境核查通过。
W6 第一批（同日）：`dev` 直接跑 Vite（`dev:app` 移除）；`typecheck`/`test` 双链覆盖（新 Vue 165 + 旧 224/4 skipped 全过）；旧 ja 术语校验抓到 2 处「開く」漂移并修正（読み込む）——双链并跑的价值实证。`build`/package/CI 大切换（Rust CI 步骤设计 + 旧脚本退场 + release.yml disposition 落地）为下一批，需一次成批完成保持一致性。
W5 收官（同日）：typecheck:app、build:app 通过；无手柄运行时（grep gamepad 无命中）；未跑 UI profiles/旧 lane（本轮改动不触及，如实跳过）。
W5 第三批（同日）：项目替换打断活动手势（revision 守卫取消）与 exportLock/bandBusy 重入护栏有测试；时间轴 pointer capture/lostcapture/unmount 清理经代码核对确认（VueUse scope 管理 observer）。
W5 第二批（同日）：对话框 [role=dialog] 期间快捷键失效有确定性测试；200 项 × 2000 切点的 undo/redo 成本测量通过（不可变快照模型预算护栏）；ElMessageBox role=dialog 已核实。
G10 轮（同日）：`test:components` 18 files / 198 passed。
G08 轮（同日）：`test:components` 17 files / 165 passed；typecheck:app、build:app 通过。
G07 轮（同日）：`test:components` 17 files / 163 passed；typecheck:app、build:app 通过。dB 往返断言改 toBeCloseTo；注意 muted track/gain≠0 的工程仍属受限（capability），track 路由投影未激活。
G11 轮（同日）：`test:components` 17 files / 161 passed。`de46b1f`。
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
