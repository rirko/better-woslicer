# TypeScript / Vue lint、fmt 与提交检查

状态：**待实施**。2026-11-11 用户追加要求；本次只更新方案，不安装依赖、启用 hook 或格式化源码。承接 [界面重构方案](UI_READABILITY_PLAN.md)。

## 1. 工具选择与职责

| 用途 | 选型 | 边界 |
|---|---|---|
| TS / JS / Vue SFC / CSS 等格式化 | **Oxfmt** | 独立 formatter；格式化不执行 import、属性或 class 排序等语义整理 |
| TS / JS / Vue 语义检查 | **ESLint flat config + typescript-eslint + eslint-plugin-vue** | TS 类型感知检查与 Vue template 检查；不由 lint 控制缩进、引号和换行 |
| 格式规则冲突处理 | **eslint-config-prettier** | 最后加载以关闭与 Prettier 兼容格式冲突的规则；不是安装第二个 formatter |
| 本地 commit 前检查 | **Husky + lint-staged** | pre-commit 检查暂存文件；失败阻止提交，不自动 fix、format 或 git add |
| 完整类型检查 | 现有 **vue-tsc / tsc** | 保留现有 typecheck；typed lint 不替代编译器 |

选型依据（2026-11-11 查阅，实施时再确认所安装版本）：

- Oxfmt 官方支持列表包含 TypeScript、Vue、CSS、JSON、YAML；适合本项目 SFC 的统一格式化。先验证本仓全部 17 个 SFC 的输出，不把供应商性能数据当成本项目实测。[Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)
- Oxlint 的兼容表仍标记 Vue 缺少 template linting，因此本批不把它作为唯一 linter，也不同时堆两套重叠的 JS/TS 检查。若以后实测 ESLint 成为瓶颈，再评估分工。[Oxc 兼容表](https://oxc.rs/compatibility)
- Vue 插件提供 flat config 与 SFC 专属检查；`.vue` 顶层必须由 vue-eslint-parser 解析，TS parser 放在 parserOptions.parser，不能覆盖掉 Vue parser。[Vue ESLint 指南](https://eslint.vuejs.org/user-guide/)
- typescript-eslint 的 typed rules 需要项目类型信息，成本高于纯语法 lint；本地可按文件增量运行，CI 跑全量。[类型感知 lint](https://typescript-eslint.io/getting-started/typed-linting/)
- Husky 管理 pre-commit 与 prepare；lint-staged 处理暂存文件、部分暂存内容的隐藏与恢复以及长命令分块，不自行拼接 Git 文件名列表。[Husky](https://typicode.github.io/husky/get-started.html)、[lint-staged](https://github.com/lint-staged/lint-staged)

所有新增包只进入 devDependencies。当前工具链统一使用 Node 26.x，选择**相互兼容的正式版本**，记录 engines/peerDependencies 并提交 package-lock；不在方案里猜版本号，不用 `--force` / `--legacy-peer-deps` 消除冲突。工具读取的 schema 使用本地 node_modules 路径，不引入产品运行时外网依赖。T0 当时的 Node 24 验证记录保留在进度文档中，不再作为后续执行要求。

## 2. 检查范围与固定命令合同

| 命令 | 含义 |
|---|---|
| `npm run lint` | 全量 ESLint，`--max-warnings 0`，只检查，不改文件 |
| `npm run lint:fix` | 人工显式运行 ESLint fix；不得由 hook/CI 调用；应用后审查副作用 |
| `npm run fmt` | Oxfmt 显式写入受管文件；首次批量运行仅由 T1 owner 执行 |
| `npm run fmt:check` | 同范围 Oxfmt `--check`，失败非零退出 |
| `npm run lint:staged` | 本地已安装 lint-staged，串行执行每组检查任务 |
| `npm run check:quality` | 串行 lint、fmt:check、现有 typecheck；不隐藏失败 |
| `npm run prepare` | 安装 Husky hook；CI 可跳过 hook 安装，但仍须运行全量检查 |

- lint 覆盖 `src`、`tests`、`scripts` 内 `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs/.vue` 以及根目录工具配置；SFC script 和 template 都要真实命中规则。CSS 由 formatter 管格式，本批不宣称提供 CSS 语义 lint。
- fmt 覆盖同范围源码，加手写 `.css/.html/.json/.jsonc/.yml/.yaml` 配置，包括 `.github/workflows`。本批不批量格式化 Markdown、LICENSE/NOTICE、音频/图片/二进制 fixture、Rust/TOML 或 lockfile；Rust 沿用现有工具与 CI。
- 两套工具均排除 `.git`、`node_modules`、`dist`、`release`、`src-tauri/target`、`src-tauri/generated`、`src/i18n/generated.ts`、`.pending-delete`、`.smell-check`、测试产物/截图目录；不要直接扫描仓库所有隐藏目录。显式传入 ignored 文件也不得进入检查。
- scripts/config、浏览器源码、Worker、测试分别配置适用 globals；不把 Node globals 放给全部浏览器文件。不要为 lint 改 package.json 的 module type。
- type-aware 范围使用专用 `tsconfig.lint.json` 显式包含源文件、Vue、测试和 TS 工具配置，`noEmit`；ESLint 使用显式 project 与 `.vue` extraFileExtensions。现有 tsconfig.app/tests 不覆盖所有组件测试和根配置，不能假设自动发现即可。JS/MJS/CJS 走独立不要求类型信息的规则块。不能禁用严格编译选项解决 parser 问题。
- 配置里列出的文件范围、hook 范围与 CI 范围要对齐；删除文件不 lint，重命名检查新路径；路径包含空格或中文要正常处理。使用工具 glob/参数 API，禁止 shell 拼接文件名。

### 规则与格式基线

- ESLint 使用 JS recommended、TS recommendedTypeChecked、Vue flat/recommended；补充 no-explicit-any、no-non-null-assertion、switch-exhaustiveness-check 等仓库要求。确认 no-floating-promises/no-misused-promises 实际覆盖 TS 和 SFC script；不得仅为了过 lint 给所有 Promise 加 `void` 而不处理拒绝路径。
- 关闭由 formatter 接管的 stylistic 规则；不启用 import 自动排序、属性排序、按行数强拆、复杂度硬阈值或“组件必须拆小”等规则。允许 Vue 样式冲突例外，不把格式偏好变成产品架构。
- 无用变量等规则不得删掉 docRevision 响应式读取；异步回调、类型断言、测试假体需逐项判断，不把语义修复藏在 lint:fix。`as const` 不能与不安全类型断言一刀切。
- Oxfmt 初始约定：2 空格、分号、单引号、100 列、LF、Vue 多属性逐行。保持 HTML 空白敏感处理；禁止自动排序 imports/package.json keys/Tailwind classes 等；按安装版 schema 写合法配置并显式关闭默认启用的排序功能。[Oxfmt 配置](https://oxc.rs/docs/guide/usage/formatter/config.html)
- formatter 的稳定输出优先于 R1 的手工换行偏好：例如它可能保留短表达式，不能靠 ignore 注释强迫每个短表达式换行。语义分组与多语句改写另做可审查 diff。
- 已有违规先导出文件/规则/原因清单；能等价修的分小卡修复。必要例外限定到具体规则和文件/行，并写原因与复核条件；不全仓关闭规则、不设静默 warning 基线、不忽略整个 tests 或 `.vue`。真实行为缺陷另立 fix 卡；影响等价合同的项交协调者处理。

## 3. pre-commit 合同

1. `.husky/pre-commit` 只调用 `npm run lint:staged`。npm script 使用本地二进制；依赖缺失时清楚失败，不能用会临时下载工具的命令。兼容 Windows Git 与 Linux，不在 hook 写 PowerShell 专用逻辑。
2. TS/JS/Vue 暂存文件先 ESLint `--max-warnings 0`，再 Oxfmt `--check`；其他受管文本只做格式检查。全局配置变化（lint/fmt config、tsconfig、package.json/lockfile）另外触发全量 lint/fmt 检查，不能只 lint 配置文件本身。
3. **检查任务只读**：不执行 `--fix`、`--write`、`git add`，不在提交时改变准备提交的内容。lint-staged 可临时隐藏/恢复未暂存部分；保留其默认备份/恢复机制，不用 no-stash/no-hide-partially-staged 绕过保护。
4. 部分暂存必须检查待提交的内容；未暂存改动在成功/失败后均完整恢复。若工具不能满足，不接受“直接检查工作树”作为替代。不要让 formatter 带入未暂存内容。
5. lint/fmt 失败阻止 commit，并给出手动修复命令；无需匹配文件时直接成功。正常路径不在 hook 跑 npm ci、全量测试、UI、打包或网络访问；不新增 commit-msg 规则。
6. hook 不是不可绕过的安全边界。CI 的全量检查是合并验证依据，不依赖开发者安装 hook；不把 `--no-verify` / `HUSKY=0` 写成日常解法。

## 4. 工作包与引导顺序

全部初始 pending。协调者拥有配置、lockfile、CI、hook、Git index 与工具基线；flash 只执行分配的格式化或违规修复小包。配置未稳定前不并行格式化。

| 卡 | 可写范围 | 验收与边界 |
|---|---|---|
| T0 工具配置与试跑 | `package.json`、`package-lock.json`、`eslint.config.mjs`、`.oxfmtrc.json`、`tsconfig.lint.json`、必要的 `.gitignore` 缓存条目；进度文档 | Node 26.x 下兼容安装；专用配置无 parser 错误；TS 类型规则与 Vue template 规则均有正反例；格式器覆盖 17 SFC、幂等；输出原有违规清单。此步尚不装 pre-commit、不启用阻断 CI |
| T1 纯格式基线 | 协调者按上述受管范围生成精确文件清单；每子卡仅能写清单中文件，不改配置 | 先 R0 行为/视觉基线，再分批 Oxfmt；连续两次 fmt 无新 diff，fmt:check 全量绿；测试/视觉与 R0 对照，保留格式专用提交，不夹语义修改 |
| T2 lint 违规清理 | 根据 T0 清单派有界卡，原则上每卡不超过 3 个生产文件及相关测试；配置只由协调者维护 | 分类解决真实问题和有据例外；全量 lint 零 error/零 warning，typecheck/受影响测试通过；记录涉及既有 R 卡的重叠，避免重复修改 |
| T3 hook 与 CI 上线 | `package.json`、`.husky/pre-commit`、`lint-staged.config.mjs`、必要的 `scripts/check-staged-quality.mjs`（仅触发全量检查判断）、`.github/workflows/build.yml`、`docs/CI.md`、`docs/refactoring/UI_READABILITY_PROGRESS.md` | 仅 T1/T2 全绿后接 prepare/hook/CI；隔离临时 Git repo 验证实际 commit 成功/失败和部分暂存恢复；正常工作树/index 不受测试污染 |

README 的开发命令区如需同步，只由协调者更新四语言同类小节；不写用户功能 changelog，不在产品 About/安装包里暴露 lint 工具。T0 依赖安装后验证 `npm ci` 可重建同一依赖，后续 T3 验证 prepare 在普通开发安装与 CI 环境的行为。

T0 与 T1 的格式专用批次取代“让 flash 手工展开全仓代码”；原 R1a–R1d 保留为 SFC 分组审查和少量语义分组整理，使用同一 formatter 输出。阶段间可用既有授权做本地 checkpoint commit；hook 仅在干净基线上启用，避免用跳过 hook 提交引导阶段代码。

### 必测场景

- 用隔离 fixture 验证：TS 中未处理 Promise/unsafe 输入等目标规则、Vue template 非法 directive/重复属性能失败；合法 SFC script/template 通过。不提交故意违规文件到正常 lint 范围。
- 格式幂等且不改 import 执行顺序、模板空白效果或 CSS 声明顺序；formatter 与 ESLint fix 不来回翻转。
- 临时 repo 实际 commit：正确代码成功；仅格式错误失败；TS lint 错误失败；Vue 模板错误失败；失败前后暂存区和未暂存区 diff 内容一致。
- 部分暂存、中文/空格文件名、rename/delete、无匹配文件、配置变化触发全量检查；无依赖环境明确失败且不下载。检查备份恢复，不在用户主工作树构造故意失败提交。
- 每次 hook 执行记录耗时；先避免重叠全量检查与重复文件任务，再评估缓存。typed lint 缓存可能漏掉依赖文件变化，CI 禁用缓存跑完整项目；不以未经测量的速度倍数做验收。
- CI 在 `npm ci` 后、构建/打包前运行 lint、fmt:check、typecheck；失败停止下游。保留现有测试与 Rust 检查。当前 verify 中 UI 测试先于 web build 的顺序也在此卡调整，确保读取本轮生产输出；不增加发布/部署。

## 5. 本方案的完成定义

工具安装与配置不等于完成：受管源码全量 lint/fmt 通过、pre-commit 正反例验证、部分暂存恢复验证、CI 命令顺序和现有回归验证均有实际证据，才可标 T0–T3 完成。未执行的环境写未验证；规划阶段不声称上述工具已在本仓可用。
