# 输入预测插件：当前架构

[项目首页](../README.md) · [贡献指南](./CONTRIBUTING.md)

## 运行与分发边界

DSH 通过 `package.json` 的 `exports["."]` 加载 `build/index.js`（Host ESM），通过 `exports["./client"]` 加载 `build/client.js`（Client classic bundle），不要求产物位于仓库根目录。两者均由 `scripts/build.mjs` 从 `src/` 构建并提交，`files` 包含 `build/`，供 GitHub 安装直接使用。bundle patch 与 Client 声明保持不变，不依赖安装时执行 prepare 或下载开发工具。

Host 运行时依赖仍只有 `@deepseek-ai/schemastery`。Client 将 `react` 留作外部模块，由 DSH 提供；不打包第二份 React，也不导入 Harness 内部 Client 包。TypeScript、React 测试依赖、Vitest、jsdom 和 Biome 均为开发依赖。

## 源码职责

| 模块 | 职责 |
| --- | --- |
| `src/shared/` | 设置与 HTTP 契约、默认值、端点、超时预算 |
| `src/host/index.ts` | DSH 注入、设置自动表单开关、注册入口 |
| `src/host/config.ts` | volatile schema 和每次请求的设置读取 |
| `src/host/domain.ts` | 上下文裁剪、预测解析、回合判断、模型优先级、流聚合 |
| `src/host/suggestion-service.ts` | 预测流程、取消、请求期限与诊断 |
| `src/host/model-catalog.ts` | 每个插件实例独立的模型目录、缓存与并发合并 |
| `src/host/http.ts` | 方法、Origin、JSON/body 限制、响应与异常出口 |
| `src/host/dsh.ts` | 实际使用的 Host 公共接口子集 |
| `src/client/api.ts` | 同源请求、响应验证、取消与传输期限 |
| `src/client/ghost/controller.ts` | 独立于 React/DOM 的状态与异步生命周期 |
| `src/client/ghost/prediction-cache.ts` | 按 Session 保存未采纳的预测与所属回合，最多 32 个会话，供切回时校验恢复 |
| `src/client/ghost/session-controls.ts` | 当前浏览器按 Session 保存的自动开关与手动命令分发 |
| `src/client/ghost/commands.ts` | `/suggest` 与 `/autopredict` 客户端指令，复用同一开关与手动请求 |
| `src/client/ghost/` | React 订阅、ghost 展示与适配层连接 |
| `src/client/settings/` | 设置订阅、草稿、校验、保存/恢复与 TSX 展示 |
| `src/client/dsh/` | 宿主接口子集、编辑器测量、placeholder、键盘与导航图标适配 |

## Host 预测流程

`POST /prompt-suggestion/suggest` 接收 `{ sessionId }`，返回 `{ suggestion, model, turn }` 或 `{ suggestion: null, reason }`，`turn` 是候选所属的已完成 `turn/end` 事件序号。`POST /prompt-suggestion/turn` 接收 `{ sessionId }`，返回 `{ turn }`；会话进行中、不存在或功能关闭时为 `null`，不调用模型。`GET /prompt-suggestion/models` 返回 `{ models: [{ provider, id, name }] }`。

1. HTTP 层验证方法、Origin、启用状态及参数，JSON body 上限 64 KiB。
2. 读取 Session，确认最近回合以 `turn/end(completed)` 结束。error、aborted、新用户消息、进行中的回合均跳过。
3. 过滤 system/developer 消息。助手的 `tool-call` 块按 `toolCallId` 与对应 `tool` 消息配对，渲染为 `[调用 工具名] 关键参数 → 结果`：参数只取 command / file_path / path / pattern / query / url / description 中第一个存在的字段（缺失时取第一个字符串值），最多 120 字符，不输出文件正文；`isError` 或非零 `exit code` 视为失败，保留输出结尾 160 字符，成功只保留开头 80 字符。连续的操作合并为一条「工具」条目，最多保留最近 6 项、1,200 字符，并注明省略数量；没有对应调用的工具结果仍显示为 `[工具结果]`，合并空白并缩写到 160 字符。长正文保留开头和结尾，中间插入省略标记，每条正文含标记最多 700 字符。先为最近一条用户需求和助手回复保留位置，再按新到旧补齐其他消息，输出恢复时间顺序；消息条数不超过配置值，总预算含角色标签、分隔符最多 7,000 字符。
4. 模型优先级为完整设置覆盖、会话模型、进程默认模型。
5. 聚合 `llm.stream()` 的 text-delta，忽略 reasoning 等事件；错误或中止结束视为失败。
6. 取第一条非空行并去掉列表与引号装饰；代码围栏、空文本与超过 200 字符的候选丢弃。`NO_SUGGESTION` 和 `null` 表示正常空候选；泛泛的中英文「继续 / continue / go ahead」丢弃，带有具体对象的动作和可推断的简短回答保留。

默认提示词允许在上下文不足、没有明确后续或无法推断问题答案时返回 `NO_SUGGESTION`，不要求每轮强行生成。候选还会与当前 Session 派生出的全部用户消息比较，包括未发送给预测模型的历史；比较会统一 Unicode 兼容形式、空白、大小写、外层引号和句末标点，只过滤规范化后相同的输入，不做模糊匹配。助手与工具文本不算历史用户输入。过滤在 Host 解析阶段执行，自定义提示词不能绕过。

空候选继续返回 `{ suggestion: null, model }`，不算模型错误、不记录失败日志，Client 保持 idle 且不自动重试；预测不写入 Session。

请求前记录 Session 实例和最新已完成 `turn/end` 的事件序号；模型返回后再次核对两者。Session 被移除或替换、出现新用户消息或新回合时返回 `stale-turn`，客户端不重试；同一回合后的 usage 等记账事件不会作废结果。HTTP 层在开始调用和回包前重新读取 volatile 启用状态，关闭后返回 `disabled`。

模型调用期限为 8 秒。客户端断开会取消调用；服务同时监听取消并结束等待，即使 provider 未响应 AbortSignal 也不会让 HTTP 一直挂起。正常失败继续返回空候选。调试日志只记录 timeout / cancelled / upstream-error 与耗时，不记录上下文、预测文本或凭据。模型调用之外的 SDK 异常由 HTTP 入口捕获并返回 500，避免悬空 rejection。

模型目录并行查询各 provider，每个查询最多等待 5 秒，保留成功结果。60 秒缓存及进行中的查询属于当前插件实例；并发请求共享一次查询，插件重新挂载后重建缓存。完成或超时后清理计时器。

## 配置热更新

enabled、systemPrompt、provider、model、maxContextMessages、maxTokens 全部声明为 volatile。DSH 字段可能是 accessor；`resolveSettings()` 在每次请求时读取，而非在 apply 时缓存。

共享默认值：上下文 16 条（允许 2–64）、maxTokens 256（允许 16–512）、默认提示词。访问器不可用或数值越界时使用默认值。设置通过 `configForms` 修改 profile 覆盖层，恢复默认使用 unset。前端保留未保存草稿，保存异常后释放 busy 状态并提示重试；只读部署禁用所有写入动作。

## Client 状态与回合边界

```text
idle → requesting → shown → accepted
           │          └──→ dismissed
           └──→ idle / dismissed
```

初次挂载到空闲会话不预测。running 从 true 变为 false 后等待 250ms，确认草稿与附件为空，再请求一次。Host 返回 not-idle 时，间隔 500ms 最多额外重试两次，兼容状态发布略早于回合事件提交的窗口。

自动预测默认开启，可用 `/autopredict` 按会话关闭。偏好在当前浏览器的 localStorage 按 Session ID 保存，只写入关闭标记，重新开启即删除；存储不可用时保留内存偏好。切换会话时使用该会话的偏好，关闭自动预测立即作废待执行和进行中的预测。

`/suggest` 指令和所属编辑器内的 `Alt+Shift+P` 可显式生成一次预测，允许空闲会话初次挂载或本轮已忽略后再次请求，也允许在关闭自动预测时使用。手动命令按 Session 分发，切换会话和卸载后注销；不保存待执行命令。它遵守全局启用状态、空闲、空草稿、无附件和非组合输入条件，复用同一控制器的取消、回包校验及重试上限，进行中的重复命令不增加调用。快捷键只在编辑器拥有焦点且请求可执行时接管；结果仍需 Tab / → 采纳，不发送消息。

能力只注册为客户端指令，不再占用 `conversation.input.right`：`/suggest` 是 action，只消费自己的 token 后运行手动命令；它等到下一个任务再请求，因为同一次事件里消费 token 后，编辑器草稿要等一次状态发布才会变空。`/autopredict` 是 popupSelect，读取并写入本会话的开关，`active` 标出当前状态；指令行的 `label()` 没有 session 参数，所以不在标题里拼「开 / 关」。两者都通过 `ctx.commandUi` 注册，不经过 Host 命令表，不产生模型消息，也不进入会话日志；`commandUi` 缺失时只跳过指令，预测与快捷键仍照常工作。

切换会话时，当前展示且带 `turn` 的预测存入共享缓存；进行中的模型请求不取消，而是转为后台请求，完成后写入缓存。缓存每次写入都会通知所有控制器，正在展示该会话的那个负责恢复，因此无论宿主是复用同一个输入框、按会话重新挂载 overlay（旧组件的请求在新组件挂载后才返回），还是保留各会话的输入框只做隐藏，结果都能回到对应会话。恢复只在空闲、无待执行任务、空草稿等条件满足时进行，先调用 turn 接口确认最新回合仍等于条目的 `turn`，一致才展示；回合已前进则删除条目，turn 暂时读不到或输入快照尚未就绪时保留条目，等下一次状态更新再试。采纳、忽略或开始输入会删除当前会话的条目；切入正在运行的会话、会话开始新回合、关闭本会话自动预测也会删除，全局关闭清空缓存并取消后台请求。组件卸载同样会存入缓存。

输入框暂时测不到尺寸（被宿主隐藏或尚未布局）时，ghost 只隐藏、不作废预测，Tab / → / Esc 也不接管；重新可见后由 ResizeObserver 或 resize 事件触发重新测量并显示。

每个延时任务与请求保存发起时的 sessionId、回合 generation 和 requestId，请求前及回包后均核对身份与当前条件。新回合、草稿或附件变化、dismiss 会作废旧编号、取消请求并清理重试；会话切换和卸载同样作废旧编号，但模型请求按上文转入后台写缓存，结果只能经 turn 校验后才会展示。ghost 通过 configForms 订阅启用状态；关闭后立即收起并取消，重新开启时等待下一轮回合结束。即使 transport 忽略 abort，或用户清空草稿、切回原会话、重新开启功能，旧结果也不能覆盖新状态。传输期限为 10 秒，为 Host 留出响应时间。

只在 ghost 可见且焦点位于所属编辑器时处理 Tab / → / Esc。采纳调用 captureInsertion 与 insertText，不调用发送动作；插入因 revision 变化返回 false 或抛错时收起。Esc 忽略本轮，输入或新回合也收起。compositionstart / compositionend、beforeinput 和 input 监听覆盖请求中的阶段，防止输入法或宿主尚未更新草稿时出现旧预测；组合输入尚未结束时不发起预测。Ctrl / Alt / Meta、Shift+Tab 和输入法键盘事件交给宿主。

## 宿主 DOM 适配

基于 `data-composer-placeholder` 和 `[contenteditable=true]` 定位，测量字体与位置。用不可见探针按可用宽度（扣除 Tab 标识）计算预测需要的行数，最多三行，并受宿主 `[data-input-scroll]` 的 max-height 限制。ghost 是浮层，不能自己撑开输入框，所以展示期间临时把编辑器的 min-height 提高到容纳这些行的高度（不低于宿主原值），让卡片和工具栏下移；收起时恢复原 inline 值。展示期间临时隐藏 placeholder，清理时恢复原来的 visibility；resize、scroll 和 ResizeObserver 触发重新测量。

DSH 0.2.x 没有公开设置导航图标入口，`dsh/nav-icon.ts` 隔离相应选择器与匹配逻辑。只替换名称匹配的插件图标，宿主结构不匹配时跳过；MutationObserver 在卸载时注销。DOM 假设由 fixture 测试覆盖，仍需随宿主版本人工验证。

## 验证与开发

`pnpm check` 包含严格类型检查、Biome、Vitest、内存构建比对与安装包验证，在本地执行。为节省运行额度，仓库已关闭 GitHub Actions CI。

- 规则测试：预算、解析、回合边界、模型选择、volatile 读取、流结束原因。
- Host 测试：真实本地 HTTP server 搭配受控 Session / LLM，验证成功、错误、Origin、热更新、断开取消、SDK 异常出口。
- 生命周期测试：缓存、并发、超时清理、忽略取消的 provider、旧会话/回合回包、重试上限、插入失败。
- React/jsdom 测试：StrictMode、Tab/→ 不发送、Esc、IME、焦点作用域、placeholder 恢复、保存失败重试、只读与下拉键盘操作。
- 安装包检查：npm pack 后只安装运行时依赖，验证公开 Host 导出、Client 的普通 CJS apply/inject 对象及宿主 React 外部依赖。

`pnpm build:check` 不改写产物；`pnpm dev` 监听双端重建，重载仍需 DSH 完成。真实模型内容质量、实际浏览器主题与视觉对齐不属于 jsdom 验证范围。

## 仍未实现

单次只展示一个候选，暂不支持点击采纳、采纳率埋点或自动更新。会话自动开关保存在当前浏览器，不跨设备同步；预测不写入 Session，也不进入后续模型上下文。
