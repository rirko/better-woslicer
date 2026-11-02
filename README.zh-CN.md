# woslicer-electron（中文说明）

[English README](README.md) · **中文说明**

woslicerIII（wosderge 的 BMS WAV 切片工具）的 Electron + TypeScript 重制版：
界面重做为常见 DAW 的横向时间轴，核心切片算法与 `.wos` 格式严格兼容原版。

- 原版 149 个导出切片逐一**逐字节复现**（oracle 测试）
- `.wos` 固定 6168 字节、MSB-first 49152 tick 位图
- 单 BPM、单音源单轨；每小节 192 tick

## 下载 / 运行

- **免安装版（推荐）**：从 [Releases](https://github.com/rirko/woslicer-electron/releases) 下载
  `woslicer-electron-0.1.0-win32-x64.zip`，解压后运行 `woslicer-electron.exe`。
- **源码运行**：Node.js 22+

```sh
npm install
npm start
```

## 功能

- **横向 DAW 时间轴**：波形从左向右，L/R 双 lane；小节线与网格密度 1/2/4/6/8/12/16/24/32
  （每小节等分数，1 = 整小节一格）；刻度尺滚轮缩放且光标下 tick 锚定；中键平移。
- **打点**：`Enter` / `,` / `.` 在播放头处打点（播放中）或光标处打点（停止态）；`Z` 切换光标处切点；
  Snap 开启时吸附当前网格，按住 `Alt` 临时免吸附。
- **选择与编辑**：`Shift/Ctrl + 左键拖动` 框选；左键在空白处单击/拖动**画点**，右键按下/扫过**擦除**；
  左键按在切点上拖动整个选区；`Ctrl+C/X/V` 复制/剪切/粘贴选中的切点（保持相对间距）；
  `Delete` 尚未实现（可用 `Ctrl+X`）。
- **量化**：只作用于选中切点，吸到当前网格。
- **播放与变速**：`Space` 播放/暂停；速率 `0.25×–1.5×`（transport 下拉或 `[` / `]`）；
  变速只影响监听，切点与导出始终按源时间。
- **敲击校准**：transport 栏 `Calibrate`，按当前 BPM 持续播放四分音符点击音，
  用 `Enter` / `,` / `.` 敲击，实时显示中位数延迟；`Apply` 后播放中打点自动补偿延迟。
- **频段显示（Bands）**：同一轨道叠加低/中/高三色包络（250 Hz / 4 kHz 分频），仅显示，不影响播放与导出。
- **频段自动检测（Band detect）**：Cuts 页折叠面板；阈值、最小间隔、频段多选、实时预计数量；
  按响度上升检测并打点，始终可吸附网格（可关闭改为精确起音），整次检测一步撤销，有选区时只作用于选区。
- **Cue 音效**：播放走带经过切点时播放牛铃 / 三角铁 / 节拍器（仅监听，不写入导出）。
- **导入导出**：WAV（PCM 8/16/24/32-bit、float）与 OGG；单片/全部导出 WAV；
  `.wos` 读写；BMSE 剪贴板读写；导出前缀默认取音源文件名。

## 快捷键

| 键 | 功能 |
| --- | --- |
| Space | 播放 / 暂停 |
| Enter / `,` / `.` | 打点（播放中=播放头位置；停止=光标位置） |
| Z | 光标处切换切点 |
| ← → / ↑ ↓ | 按网格 / 按小节移动光标（Shift+左右 = 单 tick） |
| P / O | 预览当前 / 上一个切片 |
| Q / W | 网格密度 减 / 加 |
| `[` / `]` | 播放速率 减 / 加 |
| M | 导出全部切片 |
| V / B | 写 / 读 BMSE 剪贴板 |
| A / S | 起始编号 -1 / +1 |
| N | FF 编号规则开关 |
| T / Y | 保存 / 读取 `.wos` |
| C | 清除全部切点 |
| 7 / 8 | 全部切点 -1 / +1 tick |
| Ctrl+C / X / V | 复制 / 剪切 / 粘贴选中切点 |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | 撤销 / 重做 |
| Esc | 关闭校准 / 取消手势 / 清除选区 |
| Ctrl+滚轮 / 刻度滚轮 | 光标锚定缩放 |
| 中键拖动 | 平移视图 |

鼠标：左键空白=画点，右键=擦除，Shift/Ctrl+左键=框选，左键按切点=拖动选区。

## 兼容性与限制

- 严格复刻原版切片 DSP 与 `.wos` 语义；原版 149 个导出切片逐字节一致。
- 24-bit / 32-bit / float 输入在载入时按原版语义转 16-bit 内部表示（24-bit 取高 16 位）。
- OGG 解码使用 WASM Vorbis 解码器（原版为 `OggVorbis.dll`）。
- 自动边缘检测（Edge detect）为近似实现，无原版 oracle。
- 语言切换目前覆盖界面静态文案与常见状态提示；原生菜单（File/Edit/View/Help）仍为英文。
- 敲击校准偏移为会话内设置，不写入 `.wos`。

## 开发与测试

```sh
npm run typecheck
npm test              # 单元测试（含原版切片 oracle）
node scripts/smoke-gui.js   # Electron GUI 冒烟测试
npm run build && node scripts/package-win.js   # 生成 Windows 便携版 zip
```

## 署名

woslicer II/III 作者为 **wosderge**（ahiruworks，http://ahiruworks.com/）。
本项目为独立重实现，未包含或再分发原版二进制、源码或音频素材。
原版许可允许“非商业 + 署名”的二次使用且禁止分发修改后的原版；请保持非商业用途与署名。
