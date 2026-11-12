# Vue / Tauri 移植：实施与恢复入口

本轮已重新核对第三次会话的完整记录、问答选择和最终批准计划。
当前代码检查点为 `161fc52`，此前文档为 `e959a97`；迁移尚未完成。
下一次从 [恢复指南](migration/RESUME.md) 读取当前状态和具体下一步。

| 文档 | 用途 |
|---|---|
| [恢复指南](migration/RESUME.md) | 环境检查、当前检查点、W1 起手用例、命令、验证记录、提交与交接 |
| [实施计划与差异台账](migration/IMPLEMENTATION.md) | 已定原则 D01–D13、现状缺口 G01–G14、工作包 W1–W7 与原 A–F 阶段对应 |
| [项目格式](PROJECT_FORMAT.md) | 当前 v1 字段/单位/预算、媒体权限隔离、受限能力、无损与未知版本边界 |
| [第三次会话时序](migration/THIRD_SESSION_EVIDENCE.md) | 原始用户决定、问答选择、被取代建议、中断与后续 Git 证据 |
| [最终批准计划原文](migration/THIRD_SESSION_APPROVED_PLAN.md) | 完整历史正文及出处；不代表当前完成情况 |

## 已明确的方向

- 原生业务菜单迁入 Web UI 后裁剪；保留独有业务，不照搬旧布局、菜单树和全部快捷键。
- 按钮、菜单、键盘、鼠标共享语义操作、可用性、事务和确认；未来手柄只预留适配边界。
- Project / Session / Config / Runtime / Host binding 分清；一个项目历史 owner，失败和取消不破坏既有工作。
- `.wos` 外部格式锁定；`.wosdx` 独立版本，不嵌音频，路径 hint 不授权，Web/Desktop 本机引用不互转。
- 多轨/clip/播放与视图属性先保留数据结构；本期不做多轨编排、混音或频谱。合法复杂工程应受限打开并保全保存。
- 正式入口最终使用常规 Vite + Tauri 构建/打包和简化 CI。当前 Electron 默认流程只是过渡。
- 用户已授权定期本地 commit；清理使用移动至待删除目录，不执行清理删除命令，不 push/tag/release/deploy。

## 本次复核纠正的遗漏

此前摘要把“复杂工程直接拒绝”“监控与视图留在 session”“旧打包继续保持”写得接近最终要求。
原计划要求更完整：复杂数据非破坏性受限打开；项目 global/track 属性要接有效值；
旧自制打包退出。当前实现只是中间阶段，详见差异台账。

恢复保存失败目前可能丢失待写状态，坏/未来 session 也未与不存在区分。
因此下一项优先 W1（恢复写可靠性），随后补无损能力边界、绑定、项目属性/BMHelper、输入验收和正式构建。

## 验证声明

此前已有 Vue/项目测试、Chromium 两种浏览器 profile、Rust 与旧业务回归记录。
原生 Tauri profiles、Vue Firefox、标准平台包/归档仍未完成；缺失 oracle fixtures 仍是 skipped。
本轮仅恢复和校正文档，没有改应用代码，也没有重新运行产品测试。
