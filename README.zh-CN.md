# woslicer-dx

[English](README.md) · **中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

基于 wosderge 的 woslicerIII 开发的离线 BMS 音频切片工具。

![时间轴](screenshots/timeline.png)

## 功能

- 导入 WAV/OGG，导出 WAV 切片，读写 `.wos` 工程与 BMSE 剪贴板。
- 时间轴编辑、吸附、框选、量化、撤销与重做。
- 变速监听、切点提示音和敲击校准。
- 频段显示与自动切点检测。
- 中、英、日、韩四种界面语言；“关于”显示版本、commit 和构建日期。

## 运行

从仓库 Actions 的构建附件下载对应平台的压缩包，解压后运行：

| 平台 | 格式 | 程序 |
| --- | --- | --- |
| Windows | `.7z` | `woslicer-dx.exe` |
| Linux | `.tar.xz` | `woslicer-dx` |
| macOS | `.zip` | `woslicer-dx.app` |

macOS CI 构建未公证。应用在本地处理文件，运行时无需联网。

网页版在浏览器中直接运行：[woslicer-dx app](https://woslicer-dx.sgqy.workers.dev/) ，无需安装。

源码运行需要 Node.js 24、npm 和 Git：

```sh
npm ci
node node_modules/electron/install.js
npm start
```

## 操作

| 按键 | 功能 |
| --- | --- |
| Space | 播放 / 暂停 |
| Enter / `,` / `.` | 在播放头或光标处添加切点 |
| Z | 切换光标处的切点 |
| 方向键 | 按网格 / 小节移动；Shift+左右按单 tick 移动 |
| P / O | 预览当前 / 上一个切片 |
| Q / W | 减小 / 增大网格密度 |
| `[` / `]` | 降低 / 提高监听速度 |
| Ctrl+C / X / V | 复制 / 剪切 / 粘贴选中切点 |
| Ctrl+Z / Ctrl+Shift+Z | 撤销 / 重做 |
| M | 导出全部切片 |
| T / Y | 保存 / 读取 `.wos` |
| V / B | 写入 / 读取 BMSE 剪贴板 |

左键拖动画点，右键拖动擦除，Shift/Ctrl+拖动框选，拖动切点移动选区。Ctrl+滚轮缩放，中键拖动平移，Alt 临时关闭吸附。

## 开发

```sh
npm run typecheck
npm test
npm run build
npm run test:ui
npm run package
npm run test:ui:packaged
```

音频在内部转换为 16-bit，导出使用 16-bit PCM。与原版输出的对比测试需要额外样本，缺少样本时会跳过。

参见 [CI](docs/CI.md)、[版本规则](docs/VERSIONING.md)和[变更日志](CHANGELOG.zh-CN.md)。

## 许可与署名

原版 woslicer II/III 作者为 **wosderge**。贡献者有权授权的内容采用 [MIT](LICENSE)；原版衍生部分和第三方依赖不包含在此授权内。适用范围与署名见 [NOTICE](NOTICE)。
