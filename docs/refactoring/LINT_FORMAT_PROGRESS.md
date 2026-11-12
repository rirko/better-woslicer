# Lint / fmt / commit 检查实施进度

配套方案：[LINT_FORMAT_PLAN.md](LINT_FORMAT_PLAN.md)。本文件按卡记录实际证据；没有运行证据的卡不得从 pending 改为完成。

## T0 — 工具配置与试跑：**完成（2026-11-11，未实施 T1 格式化）**

### 环境

- Node **24.22.2**（npx 缓存 `…/_npx/387698761821791d/.../bin/node.exe`；系统默认 node 为 26，执行验证时经绝对路径切换）、npm 11.20.0。
- 依赖（全部 devDependencies，lockfile 已提交）：eslint **10.14.0**、@eslint/js **10.0.1**、typescript-eslint **8.72.2**、eslint-plugin-vue **10.12.1**（vue-eslint-parser 10.4.2）、eslint-config-prettier **10.1.8**、oxfmt **0.78.0**（精确钉版，0.x 防漂移）、globals **16.5.0**。相互兼容性按各自 peerDependencies 核对（TS 5.7.x 在 typescript-eslint 支持范围内）。
- `npm ci` 重建验证通过：exit 0，五件工具版本回读一致。npm 的 esbuild postinstall 仍按本机 allowScripts 策略跳过（既有现象，非本批引入）。

### 配置决策

- `eslint.config.mjs`：js.configs.recommended（JS/MJS/CJS 不带类型信息）+ recommendedTypeChecked（typed 块用 `.map` 限定到 `*.ts/tsx/mts/cts/vue`——8.72 预设默认作用于全部被 lint 文件，会误伤无项目的 JS）+ vue flat/recommended + 显式 `project: ./tsconfig.lint.json` + `extraFileExtensions: ['.vue']`；`.vue` 顶层保持 vue-eslint-parser、script 块经 `parserOptions.parser: tseslint.parser` 获得类型感知。globals 按 `src/**`（browser）与 `scripts/**`+根配置（node）分块。补充规则：`no-explicit-any`、`no-non-null-assertion`、`switch-exhaustiveness-check`（同为 error，限定 TS 家族）。eslint-config-prettier 最后加载。全局排除 `.git/node_modules/dist/release/src-tauri/{target,generated}/src/i18n/generated.ts/.pending-delete/.smell-check/test-artifacts/test-results/playwright-report/screenshots`。
- `tsconfig.lint.json`：显式包含 `src/**/*.ts|vue`、`tests/**/*.ts`、三个根 `.mts` 工具配置；`noEmit`；types 并集 `["vite/client","node"]`（lint 专用，不参与 `npm run typecheck`）。现有 tsconfig.app/tests 不覆盖组件测试与根配置，故显式列举。
- `.oxfmtrc.json`：100 列、2 空格、分号、单引号、逐行属性（`singleAttributePerLine`）、LF、HTML 空白敏感 `css`；显式 `sortImports:false`（默认已关）、`sortPackageJson:false`（**默认开，必须关**）、`sortTailwindcss:false`；`$schema` 指向本地 node_modules。ignorePatterns 与 ESLint 排除集对齐，另含 `package-lock.json`。
- 命令合同已入 package.json：`lint`（`eslint . --max-warnings 0`）、`lint:fix`、`fmt`、`fmt:check`（同范围显式路径：`src tests scripts` + 根配置 + `.github/workflows`，不含 Markdown/LICENSE/NOTICE/lockfile/Rust）、`check:quality`（串行 lint→fmt:check→typecheck）。**未安装 Husky/lint-staged，无 prepare、无 pre-commit（T3 范围）**；未启用任何 CI 阻断。

### 试跑证据

- 全量 lint：**301 problems（300 error + 1 warning，45 文件）**，无 parser 错误、无 "file not found in project" 错误。typed 规则与 Vue template 规则均在真实文件命中。完整机器清单：`test-artifacts/lint-baseline/eslint-baseline.json`（统计脚本 `summarize.cjs`）。
- 违规分布：tests 271（主要是测试文件里 `t.run()`/异步 helper 的 `no-floating-promises` 184 条、`require-await` 48 条）；生产 src 30（`src/platform/browser.ts` 13 条最多）；SFC 仅 1 条（`BMHelperPanel.vue:29` no-unnecessary-type-assertion）。规则分布见 progress 提交的下方表。唯一 warning 是 `src/core/ogg.ts:40` 的失效 eslint-disable 注释（no-var-requires 已无问题可禁）。
- 正反例 fixture（`test-artifacts/lint-fixtures/`，独立 fixture tsconfig + config，不属于受管范围）：`bad-typed.ts` 命中 9 例（floating-promise/any/非空断言/unsafe/\*switch-exhaustiveness）；`bad-template.vue` 命中模板重复属性（parser + 规则双报）、`vue/valid-v-else`，且 **SFC script 内 `no-floating-promises` 命中**（4:1），证实类型感知覆盖 SFC script；`good-typed.ts`、`good-template.vue` 零报告。
- 显式传入 ignored 文件：ESLint 报 warning（"File ignored because of a matching ignore pattern"），配合 `--max-warnings 0` 即失败——ignored 文件不会静默通过。
- Oxfmt 幂等：把受管范围副本放在仓库外临时目录（仓库内 `test-artifacts/` 会被 gitignore 集成排除，已在仓库外副本验证）连跑两遍 `--write`，140 文件，两遍哈希完全一致；import 顺序未被改动（App.vue import 块逐字节相同）。试跑副本已移入 `.pending-delete/20261111-125844-fff/fmt-trial-scratch`。
- 真实树 `fmt:check`（只检查不写入）：**139 文件中 121 个待格式化，其中 17 个 SFC 全部在内**。清单：`test-artifacts/lint-baseline/fmt-baseline.txt`——这是 T1 的输入，T0 未对仓库执行任何格式化。

### 遗留与下一步

- T1 格式基线：**必须先完成 R0 行为/视觉基线**（见 [UI_READABILITY_PROGRESS.md](UI_READABILITY_PROGRESS.md)），再按 `fmt-baseline.txt` 分批执行 `fmt`；格式专用提交，不夹语义修改。
- T2 lint 清理：按 `eslint-baseline.json` 派有界卡。注意计划约束：不得为过 lint 给所有 Promise 加 `void` 而不处理拒绝路径；测试文件占 271 条，与生产 30 条分开派卡。
- T3 hook/CI：待 T1/T2 全绿后实施。

### 规则分布（T0 基线）

| 规则 | 数量 |
|---|---|
| @typescript-eslint/no-floating-promises | 184 |
| @typescript-eslint/require-await | 48 |
| @typescript-eslint/unbound-method | 10 |
| @typescript-eslint/no-unnecessary-type-assertion | 9 |
| @typescript-eslint/no-unused-vars | 9 |
| @typescript-eslint/no-unsafe-call | 7 |
| @typescript-eslint/no-unsafe-argument | 6 |
| @typescript-eslint/no-unsafe-member-access | 6 |
| @typescript-eslint/restrict-template-expressions | 6 |
| @typescript-eslint/no-redundant-type-constituents | 4 |
| no-control-regex | 3 |
| @typescript-eslint/no-non-null-assertion | 3 |
| @typescript-eslint/prefer-promise-reject-errors | 2 |
| preserve-caught-error | 1 |
| no-self-assign | 1 |
| @typescript-eslint/no-unsafe-assignment | 1 |
| （失效 disable 指令，warning） | 1 |

## T1 — 纯格式基线：**完成（2026-11-11，前置 R0 已就绪）**

- 执行：`npm run fmt` 一次写入全部受管范围（141 文件处理、123 文件改动），按区域分 5 个格式专用提交（`4cc9fd9` app shell / `b204047` panels+i18n / `4c660df` playback+timeline+calibration / `914a3e2` core+platform+workspace+bmhelper / `33c5358` tests+scripts+tool configs），不夹任何语义修改。
- 幂等：第二遍 `npm run fmt` 后工作树零改动；`npm run fmt:check` exit 0（"All matched files use the correct format"）。
- 行为保持：`npm run lint` **301 problems / 45 files 与格式化前完全一致**；typecheck 通过；组件 18 files / 202 passed；`npm run build:app` 通过。
- 视觉对照（对照 R0 pre-T1 归档 `test-artifacts/ui-baseline-pre-t1/`）：重采 22 个产物，其中 **10 个逐字节相同**（全部对话框场景 + computed-styles.json 两份）；其余 12 个经 Chromium canvas 逐像素比对全部为亚 perceptual 抖动——0.002%–0.28% 像素、成小簇（工具栏按钮文字抗锯齿 maxDelta≤14；时间轴标尺刻度线 1 设备像素位移 maxDelta=164），无结构差异。脚本 `test-artifacts/pixel-diff.mjs`（一次性诊断，gitignored）。
- 基线轮换：`test-artifacts/ui-baseline/` 现为 **post-T1** 捕获，作为 R1a–R1d 及后续卡的新对照基准；pre-T1 归档保留。
- 遗留：无。T2（lint 清理）可开始派卡。

## T2 — lint 违规清理：**完成（2026-11-11，全仓 lint 0 problems）**

基线 301 → **0**（`eslint . --max-warnings 0` exit 0）。七个提交，全部经协调者独立复核（逐卡重跑 lint/fmt:check/typecheck/定向测试）：

| 提交 | 范围 | 消化数 |
|---|---|---|
| `e31e56b` | 配置决策：`no-floating-promises` 增加 `allowForKnownSafeCalls`（vitest it/describe、node:test test——runner 自消费注册调用返回的 promise；回调内部调用不豁免）；`no-unused-vars` 增加 `^_` 忽略模式（接口必需参数 `smf.ts _channel`） | 185 |
| `59532e6` | 生产侧本地修复 11 文件：commands.ts 回调改属性箭头签名（类型等价，消 unbound-method）、ogg.ts 补 `cause` 链+删失效 disable、audio-client/BMHelperPanel（`defaultSort` 具名常量替代断言）、codec/session/project-media/exporter、平台三件套 `unknown \| null`→`unknown`、**新增 `tsconfig.lint.shims.d.ts`**（纯 tsc lint 解析 .vue 导入；产品 typecheck 仍走 vue-tsc 不受影响） | 16 |
| `49da1e2` | browser.ts 专卡（子代理起草、协调者逐行复核）：局部结构接口+类型守卫（检查集合与原 inline 检查逐项一致）替代 Function 调用；require-await ×8 逐方法等价性判断（含 throw 的用 `Promise.reject`，`reopenFile` 保持 rejection 以维持 `.rejects` 测试；readSession/writeSession executor 化保持同步执行时机）；rejection 包装仅影响假想非 Error 值的 message | 13 |
| `0adfad0` | T-A：tests/app 四文件（fixture 的 Platform 实现改 `Promise.resolve/reject` 风格=生产同款；async 生成器经新增 `asyncIterable` 适配器保持惰性消费语义；`this: HTMLAnchorElement` 注解） | 34 |
| `853560e` | T-B：tests/components 五文件（unbound-method 用 `satisfies Platform/Playback` 让成员回归函数属性类型，断言行逐字符零改动；滑杆序列断言区未触碰） | 17 |
| `80a664c` | T-C：project/wav/i18n/oracle 五文件（`expect.any(String) as string` 钉 matcher 属性类型——vitest 类型所限、运行时同一实例；no-op 事务 self-assign 用 `String(document.name)` 等价改写+注释；`!` 删除依据 tsconfig 无 noUncheckedIndexedAccess） | 13 |
| `b743bc3` | T-D：banddetect/bands/dsp/fixtures（`.join(',')` 与 String(array) 逐字节同；`Object.entries<number>` 泛型替代断言） | 9 |

终验（协调者重跑）：`lint` exit 0；`fmt:check` exit 0；`typecheck` exit 0；`npm run test` 全量（vitest 202 + node --test 180 pass/0 fail/4 skipped——4 个 oracle 缺 fixture 按设计跳过）；`build:app` exit 0；`test:app-ui` 双 profile 2/2；10 场景基线重采与归档对照 14–15/22 逐字节同，其余为既证的工具栏 AA/canvas 刻度单像素抖动（low/main 1717px 计数模式与历次一致）。

**过程记录（如实）**：① lint 基线 JSON 在每卡后重生成（`test-artifacts/lint-baseline/`）；② 卡面规则分布与实时 eslint 输出有漂移时以实时为准（T-A 执行者纠偏）；③ **失误**：T2 视觉对照时先重采覆盖了 `ui-baseline/` 才做归档，pre-T2 直接对照件丢失——补救链：post-T1≈post-R1（R1 合并验证）+ post-T2≈post-T1 归档（本次 14/22 同+抖动）+ 同代码双跑对照 15/22 同；教训归档必须在覆盖前完成；④ 与 R 卡重叠：BMHelperPanel `defaultSort`（R9 区域，命名常量与其"明确区分单位"方向一致）、browser.ts 类型守卫（改善 F-1–F-6 所在平台层的防御性，无权限放宽）。

## T3 — hook 与 CI 上线：**完成（2026-11-11；托管 CI 首跑未验证）**

- 依赖（devDependencies）：husky **9.1.7**（Node ≥18）、lint-staged **16.4.0**（Node ≥20.17），均兼容 Node 24。
- 命令合同补全：`prepare`=`husky`（`npm ci`/install 时设置 `core.hooksPath=.husky/_`）；`lint:staged`=`lint-staged --concurrent false`（16.x 无 `--concurrency`，串行旗标是 `--concurrent false`）。
- `.husky/pre-commit` 仅一行 `npm run lint:staged`（无 PowerShell 专用逻辑；`.husky/_` 由 husky 自带 ignore 排除，不入库）。
- `lint-staged.config.mjs` 三组：代码 `*.{ts,tsx,mts,cts,js,mjs,cjs,vue}` → `eslint --max-warnings 0` 再 `oxfmt --check`；其他受管文本 `*.{css,html,json,jsonc,yml,yaml}` → `oxfmt --check`；工具配置（eslint/oxfmt/tsconfig×4+shim/package.json+lockfile/三份 runner 配置）→ `scripts/check-staged-quality.mjs`（忽略文件列表，串行跑全量 `lint` + `fmt:check`，按其退出码阻断）。全部只读：无 `--fix`/`--write`/`git add`。
- **合同语义注记**：配置变更触发的全量检查读取**工作树**（不是仅暂存内容）；工作树里未暂存的不合规内容会阻断配置提交（验证中实测：未暂存脏文件使配置提交被 fmt:check 挡下）——保守失败，不会把未暂存内容带入提交。
- CI（`c24096e`）：`build.yml` web job 在 `npm ci` 后、`typecheck`/测试/构建前新增 `npm run lint`、`npm run fmt:check`；失败即停下游。方案所述"UI 测试先于 web build"的旧序在当前工作流中已不存在（现为 build → playwright install → test:app-ui），无需调整。未使用 ESLint 缓存（typed lint 缓存可能漏依赖变化）。`docs/CI.md` 与四语言 README 开发命令区已同步。
- 隔离临时 repo 实际 commit 验证（`test-artifacts/t3-hook-validation.mjs`，忠实小克隆：完整 src/tests/scripts 拷贝 + node_modules junction；**不触碰本仓 index/工作树**）——**13/13 通过**：

| 场景 | 结果 |
|---|---|
| 正确代码全量暂存提交 | 成功（hook+commit 56.4s，约 140 文件 typed lint） |
| 仅格式错误 | 阻断，报 oxfmt；失败前后 `git diff --cached` 完全一致 |
| TS lint 错误（floating promise） | 阻断，报 no-floating-promises |
| Vue 模板错误（重复属性） | 阻断，报 vue 规则 |
| 部分暂存（index 合规、工作树有未暂存脏内容） | 提交成功；未暂存改动提交后完整恢复、diff 仍在 |
| 中文+空格文件名 | 成功 |
| 暂存删除 | 成功（删除文件被跳过） |
| 无匹配文件（仅 .md） | 成功（8.9s，主要是 npm+lint-staged 启动开销） |
| 暂存工具配置 | 触发全量 lint+fmt:check 后成功（26.7s） |
| 无 node_modules 环境 | 明确失败（`'lint-staged' is not recognized`），无任何下载行为 |

- 现场正例（本仓真实提交）：`7c8a562`（package.json 等 → 配置路径全量检查，29.2s 通过）、`c24096e`（yml+md → 13.8s 通过）。
- 完成定义对照（方案 §5）：受管源码全量 lint/fmt 通过 ✓；pre-commit 正反例 ✓；部分暂存恢复 ✓；CI 命令顺序 ✓（**托管 runner 首跑未验证**——需 push，未获授权）；现有回归（lint 0 / fmt 0 / typecheck 0）在 T3 改动后复验 ✓。Linux 下 hook 行为未实测（单行 sh 命令，预期可移植，标注未验证）。
- 遗留：验证用临时 repo 保留在 `R:\TEMP\woslicer-t3-20261111122155`、`…122244`、`…122344`、`…122552`、`…123153`、`…123608`（各含 `-bare` 伴生目录）。**它们内含指向本仓 `node_modules` 的 junction：处置时必须先解除 junction 链接本身，禁止对其父目录做递归删除或跨盘移动（会沿 junction 触及真实依赖）**；本轮按"不删除"规则原地保留。
- hook 耗时观察（供后续评估，不作验收）：启动开销约 7–9s；全量暂存 56s 属极端情形，日常少量文件提交远低于此；尚未引入缓存。
