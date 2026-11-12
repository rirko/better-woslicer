# `.wosdx` 项目格式与能力边界

本文件记录 `161fc52` 的 v1 wire schema，以及尚未接通的已批准行为。
不把“字段存在”视为功能可用。当前计划见 [实施台账](migration/IMPLEMENTATION.md)，
历史依据见 [最终批准方案](migration/THIRD_SESSION_APPROVED_PLAN.md)。

## 格式与版本

- `.wos` 是固定 6,168 字节的外部设置交换格式，见 `src/core/wos.ts`；不加字段、不改变既有互通格式。
- `.wosdx` 是有界 UTF-8 JSON，`format: "wosdx"`、`schemaVersion: 1`。
- schemaVersion 与应用 package version、session version、Rust crate version 独立。
- 文件不包含音频。BMHelper 数据可以内嵌；音频只保存媒体事实和来源提示。
- 编解码入口是 `src/project/codec.ts` 的 `decodeProject` / `parseProject` / `encodeProject`；类型与预算在 `schema.ts`。
- 不合法 UTF-8/JSON、错误 format、越界字段/重复 ID/悬空引用等拒绝；未来版本单独分流，不尝试降级解释。

## 当前 v1 字段

| 路径 | 类型 / 单位 / 语义 |
|---|---|
| `projectId`, `name` | 稳定项目 ID、显示名；不得因媒体恢复或重新 decode 自动换 ID |
| `timing.bpm`, `timing.shiftTicks` | BPM 与 tick 偏移；不是秒或源帧 |
| `slicing.fadeoutMs` | 整数毫秒 |
| `slicing.noisegateDb`, `noisegateEnabled` | dB 阈值与开关，互不替代 |
| `slicing.markers` | tick 数组；192 ticks/measure，范围 0..49,151；编解码规范化排序，重复 tick 拒绝 |
| `slicing.bandDetection` | `bands {low,mid,high}`、`thresholdDb`、`minGapUnits`、`snap`；检测配置不是波形可见性 |
| `output` | `baseName`、`clipStartNumber`、`useFfNumbering` |
| `global` | `masterGainDb`、`masterMuted`、`cueGainDb`、`cueMode`、`playbackRate`、`views` |
| `global.views` | `rms` / `bands` 布尔默认；`spectrum: "reserved"` |
| `media[]` | 下表的媒体事实和 hint；按 mediaId 引用 |
| `tracks[]` | `trackId`、`name`、`gainDb`、`muted`、`solo`、`views`、`clips[]` |
| `track.views` | `rms` / `bands` 为 `null`（inherit）、`true`、`false`；`spectrum: "reserved"` |
| `clip` | `clipId`、`mediaId`、`timelineStartSeconds`、`sourceOffsetFrames`、`frameCount` |
| `bmhelper` | `null` 或 `{format: "bmh", bytesBase64: string}`；目前 codec roundtrip，尚未接 BMHelper 编辑器 |

| MediaAsset 字段 | 语义 |
|---|---|
| `mediaId`, `name`, `format` | 稳定身份、原文件名、`wav` 或 `ogg` |
| `byteLength` | 原文件字节数或 null，不是 PCM buffer 大小 |
| `sampleRateHz`, `channels`, `framesPerChannel` | 已知事实或 null；frames 是每声道源帧，不乘声道数；时长由 frames/rate 推导 |
| `integrity` | null 或 `{algorithm: "sha256", digest: <64 hex chars>}`；解析会统一小写 |
| `originHint` | null、`{kind: "desktop", pathHint}` 或 `{kind: "browser", name, relativePathHint?, lastModified?}` |

## 坐标、播放和视图语义

Clip 的 timelineStartSeconds 独立于 BPM；sourceOffsetFrames/frameCount 使用该媒体 sampleRateHz 的源坐标。
改变 BPM 不应改变音频片段的秒位置或媒体帧数。source offset + frameCount 在已知媒体长度内；ID 引用必须完整。
`timelineStartSeconds > 0` 表示开头留白；数组顺序不隐含位置；重叠 clip 先作为可保存数据，不承诺混音/crossfade。

gain 用 dB，0 dB 为 unity；mute 独立于 gain。任一轨 solo 时只听未 mute 且 solo 的轨道，mute 优先，多个 solo 可同时有效。
masterMuted 控制素材总线，cue 独立路由；不能让 master/track 的音量语义无意控制 cue。
本期只接当前单轨有效值，不实现多轨求和/headroom/响度策略。

有效 RMS/bands 视图为 track override 非 null 时取其值，否则取 global default。
频谱仅保留 `reserved`，不暴露已启用开关或发送分析任务。
当前控件尚未全部消费这些字段，见 G07，不能用 schema 支持宣称单轨属性已接通。

## 当前边界与资源预算

数值须有限，整数字段须为安全整数；完整限制以 codec/schema 为准。

| 项目 | 当前限制 |
|---|---|
| 编码后的完整 JSON | 16 MiB；包含 base64 和所有 metadata |
| media / tracks | 各最多 256 |
| clips | 所有轨道合计最多 100,000 |
| markers | 最多 49,152，tick 0..49,151 |
| source frame / offset / count | 单字段 0..2,000,000,000；还须满足片段范围约束 |
| timelineStartSeconds | 0..1,000,000,000 秒 |
| track/master/cue gain | −96..+12 dB |
| BPM / shiftTicks | 0 < BPM ≤ 10,000；shift −1e9..1e9 |
| fadeout / gate | 0..60,000 整数毫秒；gate −200..0 dB |
| sample rate / channels | 已知值 1..768,000 Hz；1..64 声道 |
| 媒体 byteLength 元数据 | null 或 0..16 GiB；不代表 host 支持加载这么大的文件 |
| 实际音频输入 | 当前平台上限 2 GiB；decode 还受实际内存与格式限制 |
| playbackRate | 0.25..1.5 |
| BMHelper base64 字段 | 字段自身最多 32 Mi 字符，但完整文件 16 MiB 上限更严格；目前只验证 envelope/base64，不证明 BMH 内容可用 |

`createEmptyProject` 默认一条空轨、无 media/clip。`createSingleTrackProject` 默认一条轨、一段完整源、时间位置和 offset 为零。
当前空项目默认 master −10 dB、cue −6 dB、rate 1、cue off、RMS/bands false；track 0 dB、未 mute/solo、视图继承。
这些是目前构造器值，不代表未来 Config 已能配置它们。

## 能力分流：目标与当前差异

| 输入 | 获批目标 | 当前实现 |
|---|---|---|
| 空项目 | 可编辑设置、保存 | 支持 |
| 完整单轨布局、媒体缺失 | 开文档、显示失联、编辑非媒体内容、保存、手动重关联 | 基本路径已连通 |
| 单轨带 gain/mute/solo 或视图覆盖 | 视图/播放使用有效属性；与保存恢复一致 | track 非中性播放属性现在被 capability 判为 unsupported；global/视图字段接入未完成 |
| 多轨/多 clip/offset/trim/leading silence 等合法布局 | 受限打开、说明不支持的操作、保全后保存；不能默默只取第一段 | 已完成（5375e68）：受限打开、编辑/播放/WOS 操作禁用、保存原字节 |
| future schema | 保留输入、独立提示，不进入可覆盖编辑态 | 已完成：打开前抛错且不改动当前工作区、不落任何写；原文件本身留在磁盘即保全；恢复存档侧 future 记录另有 W1b 显式保全 |
| invalid/corrupt | 不替换当前项目，不覆盖源记录，给出失败状态 | 项目 open 有错误保护；session 区分与保全不足，W1 修复 |

当前 `projectCapability` 的 single-track 要求 1 轨 1 clip、完整已知源长、位置/offset=0、track gain=0 且未 mute/solo。
空项目分支先返回；全局控制并未完整参与播放能力验证。不能把这些临时限制定义为永久 v1 格式限制。

## 无损、未知字段与版本注意事项

“复杂工程无损”至少要求保留所有合法已知媒体、轨道、片段、时间位置、属性和 BMH 内容，不发生压平或暗中裁切。
canonical JSON 的空白、字段顺序不承诺字节一致；与 `.wos` 字节兼容要求不同。

当前 parser 构造已知字段的新对象：markers 会排序（重复 tick 拒绝），digest 会小写，track spectrum 的 null 会转 reserved。
未知附加字段不会静默丢失（53a5f57）：`parseProject` 逐节点收集未知键路径到 `unknownFields`（上限 16 条），
可编辑工程打开时以 `projectUnknownFields` 明确披露“保存仅保留可识别数据”；受限工程的保存走原字节，不受此规范化影响。
对不能安全理解的输入，规范化范围的边界为：复杂布局原字节保全（受限只读），未知字段明确披露后规范化保存，future 版本拒绝打开且不落盘。

W2a.1 已将文件解码结果扩展为 `ProjectDecodeResult`：`decodeProject` 在校验通过后额外返回 `sourceBytes`，
复制输入 view 而不共享底层存储（包括 Node Buffer 子视图）。这个副本保留未知字段、规范化前的值、BOM、空白和数字拼写，
对 supported 和 unsupported-version 两个分支都有效。它由调用者持有且可变，只用于未编辑文件的保全；不能代替编辑后文档的编码。
`parseProject` 不附带文件字节，`encodeProject` 仍是规范化 v1 writer；原始字节不属于 ProjectDocument 或 undo 历史。
受限打开、保存与 session 生命周期已在 5375e68 接通：复杂布局以只读打开并显示 `projectLimitedOpen`，
文档修改在 editor 层单点拦截，保存原样写出 `sourceBytes`（逐字节测试覆盖）；从恢复存档还原的复杂工程保持只读，
因存档不含原始字节而明确不可保存（`limitedSaveUnavailable`）。

## 本机绑定、恢复与重关联

Portable project 不能含 Tauri UUID、picked token、Blob URL、FileSystemHandle、PCM 或机器窗口状态。
`projectId/mediaId → host-local binding` 独立持久化；decode 失败不应删除绑定，更不能将桌面路径当浏览器引用转换。
读取项目中的 pathHint 不能触发任意磁盘读取；用户 picker 授权或已验证的本机授权才可读取。

重关联先 stage/decode，再比较 name/size/format/rate/channels/frames/hash。名字相同不能证明内容相同；未知事实不伪造。
目标是差异明确提示、确认后原子替换；当前对不匹配硬拒绝是临时保护。
取消/失败不改文档、绑定和历史；确认引起媒体事实变更时，要按项目事务并说明是否影响 clip 范围，不能偷偷截断。

`.wos` 导入只映射其能表达的字段，不从文件虚构媒体。当前“向已加载音频导入设置”会保留真实媒体，
历史接管任务另有“从 WOS 建空项目”方案；在 W2 显式区分，保留相应确认与测试。
`.wos` 导出是有损投影，不把整个项目标为已保存；拒绝 fractional gate 等不能编码的值，不 flatten 多轨。

## 验收用例入口

已有 `tests/project/project.test.ts`、`tests/project/editor.test.ts`、`tests/app/project-files.test.ts` 和
`tests/app/project-workflow.spec.ts`。补齐能力/版本无损、host 隔离、恢复身份和错配确认时，写可观察行为测试。
`.wos` 外部格式继续跑纯业务回归；缺失 original oracle fixtures 必须标 skipped，不能声称验证了原版兼容性。
