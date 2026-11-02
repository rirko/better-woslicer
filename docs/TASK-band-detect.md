# 待实现任务：频段显示 / 频段自动检测 / 鼠标改键 / 导出前缀

> 状态：已冻结契约，等待 GLM-CODER 供应商恢复后派发。
> 设计来源：DEEPSEEK 增量规格（2026-10-30）。

## A. 导出默认前缀修正

- 现象：导出文件默认前缀是 `slice`，不是音源名。
- 根因：`applyLoadedAudio` 只设置了 `input-basename` 的 DOM 值，未同步 `store.baseName`（只有 input 的 change 事件才更新 store）。
- 修复：载入音频时 `store.baseName` 同步为清洗后的音源名（沿用 `info.name.replace(/[^\w.-]/g, "_")` 规则），输入框显示同值；单片/总导出/保存建议名统一取 `store.baseName`。
- 测试：纯函数 sanitize 或 store 同步逻辑单测；smoke 断言载入后 `input-basename` 与导出使用的 baseName 一致且不再是 `slice`。

## B. 频段叠加显示（Bands）

- 命令栏缩放组（−/+）左侧新增 `Bands` toggle（`.cmd-btn.toggle`、`aria-pressed`、内嵌 6×6 低/中/高色块），默认关闭，仅会话记忆，不写入 `.wos`。
- 分频：L/R 各自独立，固定 250 Hz / 4 kHz 分频（二阶 Butterworth / Linkwitz-Riley biquad 级联），生成三条频段信号及峰值缓存（复用 `buildPeakCache`/`peakRange`；开启 Bands 后首次计算，载入新音频时失效重算）。
- 绘制：同一 lane 内叠加，原波形降为 35% 参考；三段只画包络线不填充：
  - Low `#B18CFF` 1px 实线 85%
  - Mid `#A8D46A` 1px 虚线 4/2 75%
  - High `#F08FB4` 1.25px 实线 85%
  - 顺序低→中→高；低于 -60 dBFS 不画；切点/选区/播放头保持最上层；新增 CSS 变量 `--band-low/mid/high`；Overview 不显示频段。
- 纯 DSP 模块放 `src/core/bands.ts`，补单测：100 Hz 主要进 Low、1 kHz 进 Mid、8 kHz 进 High，能量交叉检查。

## C. 频段自动检测（Band detect）

- 左栏 Cuts 标签顶部新增可折叠 `Band detect` 区：
  - 频段多选 chip Low/Mid/High（默认全选，至少一个）
  - `Rise threshold`：dB，默认 +6.0，范围 +2.0~+24.0，步进 0.5
  - `Min gap`：1/2/4/8 个当前网格单元，默认 1
  - 实时 `Estimated: N cuts`（150ms 防抖）
  - 范围提示：有蓝色时间范围选区时 `Scope: selection … · only this range`，否则 `Scope: whole track (no range selection)`
  - `Detect` 主按钮（运行中 Detecting…）
- 算法（新纯模块 `src/core/banddetect.ts`）：每频段每声道 20ms RMS，与之前 200ms 局部基线比较，上升 ≥X dB 且持续 30ms 记为命中，命中点=上升起点；L/R 逐帧取最大值；结果吸附当前 Grid（始终吸附，与 Snap 开关无关）；按 Min gap 抑制；排除已存在 marker；只增不删。
- 范围：仅当 `selectionStartTick`/`selectionEndTick` 都存在时限定范围内检测；只选中切点不算范围；无范围则全轨。
- 撤销：整次检测一步撤销（0 新增不产生撤销项）；状态栏 `Band detect: +N cuts (Low/Mid/High ≥ +6.0 dB) · 1 undo step`，有范围加 `in selection`，附 skipped/existing 统计；结果不自动选中。
- 单测：合成信号（低频 100 Hz 在 t=0.5s 突增 12 dB）检出且落在网格；阈值过高返回 0；Min gap 抑制；区域限定；已存在去重；一步撤销。

## D. 鼠标交互改键

| 输入 | 行为 | 光标 |
| --- | --- | --- |
| 左键空白按下/拖动 | 画点：单击加 1；拖动每跨 1 网格加 1；Alt 取消吸附；Snap 关闭时 2px 节流 | 十字+加号 |
| 左键命中切点（≤10px） | 移动选区（未选中先选中；Alt = 1 tick 精度） | `ew-resize` |
| 右键按下/扫过 | 擦除：8px 半径、16px 圆环提示，一次手势一步撤销 | 圆环减号 |
| Shift/Ctrl + 左键拖动 | 框选（Shift 并入、Ctrl 切换） | 虚线框十字 |
| 中键拖动 | 平移（不变） | `grabbing` |

- 优先级：Shift/Ctrl > 切点命中 > 空白画点。
- 左键按下 3px 内待定不写文档；松开合并一步撤销；Esc 取消手势恢复原状（未拖动时仍清选区）。
- `MarkerDoc` 增加批量操作 API（一次 pushUndo、批量置位/清除），供画点/擦除/检测共用；单点 API 保留给键盘 Z/Enter。
- 测试：批量画点一步撤销、擦除一步撤销、Shift 框选、命中切点拖动、3px 阈值。

## 验证口径

`npm run typecheck`、`npm test`（oracle 149/149 全绿）、`npm run build`、`node scripts/smoke-gui.js`：
新增 smoke —— Bands 开关后画布出现频段颜色像素、Band detect 增加 N 个切点且 Ctrl+Z 一步全撤、左键拖动画点、右键扫过擦除、Shift+拖动框选；既有 28 项不回归。

## README 条目

Bands / Band colors / Band detect / Rise threshold / Min gap / Scope / Left mouse / Right mouse / Undo 关系 / Cursors / Edge detect vs Band detect。
