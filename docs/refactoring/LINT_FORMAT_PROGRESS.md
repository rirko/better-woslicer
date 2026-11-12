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

## T2 — lint 违规清理：pending（前置：T0 清单，本文件）

## T3 — hook 与 CI 上线：pending（前置：T1/T2 全绿）
