# 输入预测插件：当前架构

## 运行与分发边界

DSH 加载根目录 `index.js`（Host ESM）和 `client.js`（Client classic bundle）。两者均由 `scripts/build.mjs` 从 `src/` 构建并提交，供 GitHub 安装直接使用。`package.json` 的 exports、files、bundle patch 与 Client 声明保持这些入口。

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
| `src/client/ghost/` | React 订阅、ghost 展示与适配层连接 |
| `src/client/settings/` | 设置订阅、草稿、校验、保存/恢复与 TSX 展示 |
| `src/client/dsh/` | 宿主接口子集、编辑器测量、placeholder、键盘与导航图标适配 |

## Host 预测流程

`POST /prompt-suggestion/suggest` 接收 `{ sessionId }`，返回 `{ suggestion, model }` 或 `{ suggestion: null, reason }`。`GET /prompt-suggestion/models` 返回 `{ models: [{ provider, id, name }] }`。

1. HTTP 层验证方法、Origin、启用状态及参数，JSON body 上限 64 KiB。
2. 读取 Session，确认最近回合以 `turn/end(completed)` 结束。error、aborted、新用户消息、进行中的回合均跳过。
3. 过滤 system/developer 消息；工具文本合并空白并缩写到 160 字符，每条正文最多 700 字符；保留最近配置条数，正文预算 7,000 字符。
4. 模型优先级为完整设置覆盖、会话模型、进程默认模型。
5. 聚合 `llm.stream()` 的 text-delta，忽略 reasoning 等事件；错误或中止结束视为失败。
6. 取第一条非空行并去掉列表与引号装饰；代码围栏、空文本与超过 200 字符的候选丢弃。

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

每个请求保存发起时的 sessionId、回合 generation 和 requestId。会话切换、新回合、草稿输入、dismiss 或卸载会作废旧编号、取消请求并清理重试；回包后再次核对身份与当前条件。即使 transport 忽略 abort，旧结果也不能覆盖新状态。传输期限为 10 秒，为 Host 留出响应时间。

只在 ghost 可见且焦点位于所属编辑器时处理 Tab / → / Esc。采纳调用 captureInsertion 与 insertText，不调用发送动作；插入因 revision 变化返回 false 或抛错时收起。Esc 忽略本轮，输入或新回合也收起。compositionstart 监听覆盖请求中的阶段，防止输入法尚未更新草稿时出现旧预测。Ctrl / Alt / Meta、Shift+Tab 和输入法键盘事件交给宿主。

## 宿主 DOM 适配

基于 `data-composer-placeholder` 和 `[contenteditable=true]` 定位，测量字体、位置及工具栏上沿，最多显示三行。展示期间临时隐藏 placeholder，清理时恢复原来的 visibility；resize、scroll 和 ResizeObserver 触发重新测量。

DSH 0.2.x 没有公开设置导航图标入口，`dsh/nav-icon.ts` 隔离相应选择器与匹配逻辑。只替换名称匹配的插件图标，宿主结构不匹配时跳过；MutationObserver 在卸载时注销。DOM 假设由 fixture 测试覆盖，仍需随宿主版本人工验证。

## 验证与开发

`pnpm check` 包含严格类型检查、Biome、Vitest、内存构建比对与安装包验证；CI 在 Node.js 22 / 24 上冻结安装后执行同一命令。

- 规则测试：预算、解析、回合边界、模型选择、volatile 读取、流结束原因。
- Host 测试：真实本地 HTTP server 搭配受控 Session / LLM，验证成功、错误、Origin、热更新、断开取消、SDK 异常出口。
- 生命周期测试：缓存、并发、超时清理、忽略取消的 provider、旧会话/回合回包、重试上限、插入失败。
- React/jsdom 测试：StrictMode、Tab/→ 不发送、Esc、IME、焦点作用域、placeholder 恢复、保存失败重试、只读与下拉键盘操作。
- 安装包检查：npm pack 后只安装运行时依赖，验证公开 Host 导出、Client 的普通 CJS apply/inject 对象及宿主 React 外部依赖。

`pnpm build:check` 不改写产物；`pnpm dev` 监听双端重建，重载仍需 DSH 完成。真实模型内容质量、实际浏览器主题与视觉对齐不属于 jsdom 验证范围。

## 仍未实现

单次只展示一个候选，暂不支持点击采纳、会话级开关、采纳率埋点或自动更新。预测不写入 Session，也不进入后续模型上下文。
