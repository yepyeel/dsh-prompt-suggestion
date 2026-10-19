# DSH 提示词预测插件 · 设计方案

> 目标：每轮对话结束后，在输入框中以灰色 ghost 文本提示"你下一句可能想说什么"；按 `Tab` 或 `→` 填入输入框，**只填入、不发送**。

---

## 1. 范围

### 做

- 助手一轮回复**正常结束**后，若输入框为空，异步预测 1 条用户下一句。
- 以灰色 ghost 文本显示在输入框光标起始处，与正文同字体、同字号。
- `Tab` / `→` 采纳：文本进入草稿，光标置于末尾，停留在输入框，等待用户继续编辑或按 Enter 发送。
- `Esc`、开始输入、切换会话、切换回合都会让 ghost 消失。
- 每个会话可单独关闭；全局可关闭。
- 记录曝光 / 采纳 / 忽略，用于后续迭代 prompt。

### 不做（v1）

- 用户已经在打字时的**逐字补全**（成本高、与 IME 冲突多）。
- 一次展示多条候选、上下键切换。
- 把建议写进会话日志或模型上下文。
- 跨会话学习、云端同步。

---

## 2. 体验定义

### 2.1 出现条件（全部满足）

| 条件 | 说明 |
| --- | --- |
| 助手回合结束 | 最后一条为已结算的 assistant 消息，Session 处于 idle |
| 回合原因正常 | `completed`；`error` / `aborted` / `max-tokens` 不预测 |
| 草稿为空 | 避免覆盖或打断用户已输入内容 |
| 插件开启 | 全局开关 + 当前会话开关 |
| 本轮未忽略 | 用户按过 Esc 或开始输入后，本轮不再出现 |
| 无待处理交互 | 审批、提问、计划确认等弹窗存在时不预测 |
| 冷却通过 | 距上次预测 ≥ `minIntervalMs`（默认 1000ms） |

### 2.2 视觉

- 位置：输入框内、光标本应在的第一行行首。
- 样式：正文同款字体/字号/行高；颜色 `--dsw-alias-label-secondary`，透明度约 0.55；不换行，超出用省略号。
- 可加一个极轻的尾部提示 `⇥`，仅在输入框聚焦时显示，用于发现键位（可选）。
- 纯展示层：`pointer-events: none`，不抢焦点、不影响点击定位光标。
- 不显示"AI 正在猜"的加载态；超过 700ms 仍未返回就不展示本次结果，避免闪一下又消失。

### 2.3 键位

| 按键 | 行为 |
| --- | --- |
| `Tab` | 采纳，`preventDefault` |
| `→` | 采纳，仅在草稿为空、光标在起始处时 |
| `Esc` | 关闭本次提示（不等于关闭功能） |
| 任意字符键 / 退格 | 让编辑器正常处理，同时立即隐藏 ghost |
| `Enter` | 不拦截，仍是原生发送 |

要求：输入法组合输入（`e.isComposing`）期间不响应、不显示。

### 2.4 状态机

```
idle
 ├─(回合适配 且 草稿为空)→ requesting
requesting
 ├─(拿到结果 且 仍满足条件)→ shown
 ├─(超时/失败/取消)→ idle
shown
 ├─(Tab/→)→ accepted → insertText → idle（草稿非空）
 ├─(Esc)→ dismissed(本轮)
 ├─(开始输入/失焦/切换会话/新回合)→ idle
```

---

## 3. 总体架构

```
┌───────────────────────────── Client ─────────────────────────────┐
│ conversation.input.overlay  (list, session scope)                 │
│   └─ PromptGhost                                                  │
│        useInput        → 草稿是否为空 / 当前文本                   │
│        useChat         → 最后一条是否为已结算 assistant            │
│        inputActions    → captureInsertion() / insertText()        │
│        keydown capture → Tab / → / Esc                            │
└───────────────────────────────┬──────────────────────────────────┘
                                │  suggest({ sessionId, draft })
                                ▼
┌───────────────────────────── Host ────────────────────────────────┐
│ promptSuggestion service                                          │
│   ctx.sessions.get(id) → deriveMessages() → 裁剪上下文             │
│   session.requestHeader() / agentDefaultModel → provider+model     │
│   ctx.llm.stream({ system, messages, maxTokens, signal })          │
│   → 解析首行 → { suggestions: string[] }                           │
└───────────────────────────────────────────────────────────────────┘
```

**关键取舍**

1. **Host 只算，不推**。Client 在观察到回合结束时主动请求，省掉 projection、Remote event、流式推送。
2. **Client 只传 `sessionId`**，不传对话内容。Host 自己读 Session，上下文权威且不重复跨进程传输。
3. **预测结果只存在于内存**，不写会话日志。写进去会污染 `deriveMessages()`、破坏重放、白烧 token。
4. **不做流式**。几十个 token，等完整结果再一次性显示；流式会让 ghost 文字不断变长，体验更差。

---

## 4. 客户端设计

### 4.1 Slot

`conversation.input.overlay`（list，session scope，"Floating entries rendered inside the resident composer card"）。

- 现有占用：`slash-menu`、`command-popup`、`feedback-dialog`。
- 注册 `id: 'prompt-ghost'`，`order` 取较早值，保证在弹层下方。
- 标准 props 已提供 `useInput`、`inputActions`、`sessionId`、`useChat`、`useConversation`，无需额外 owner props。

### 4.2 定位

宿主没有暴露编辑器坐标，需要在浮层挂载后自己量一次，并在 `resize` / 字体变化时重测：

```ts
function measureEditorLine(overlayEl: HTMLElement) {
  let card: HTMLElement | null = overlayEl
  while (card && !card.querySelector('[contenteditable="true"]')) {
    card = card.parentElement
  }
  const editor = card?.querySelector<HTMLElement>('[contenteditable="true"]')
  if (!card || !editor) return null

  const c = card.getBoundingClientRect()
  const e = editor.getBoundingClientRect()
  const cs = getComputedStyle(editor)
  return {
    left: e.left - c.left + parseFloat(cs.paddingLeft),
    top: e.top - c.top + parseFloat(cs.paddingTop),
    width: e.width,
    lineHeight: parseFloat(cs.lineHeight) || 22,
    font: cs.font,
  }
}
```

要点：

- 不依赖宿主的 class 名，只用"最近的、包含 `[contenteditable=true]` 的祖先"当卡片，抗改版。
- ghost 用 `position: absolute` 定位到卡片内计算出的坐标。
- `MutationObserver` 观察编辑器是否出现/消失（新会话切换时编辑器可能重建）。

### 4.3 与原生 placeholder 的冲突（主要视觉风险）

草稿为空时，编辑器会显示宿主自己的占位文案，ghost 会和它叠字。

优先级从高到低尝试：

1. **隐藏占位符**：仅在 ghost 显示期间，对编辑器 `:empty::before` 注入 `content: none` 的作用域样式。最干净，但依赖宿主占位符实现方式。
2. **覆盖条**：ghost 外层画一条与输入卡片同色的不透明底条，盖住占位文案后再画 ghost。不碰宿主 DOM，但要求底色 token 与卡片实际底色一致。
3. **降级形态**：不追求行内 ghost，改为输入卡片内、编辑器上方一行浅色提示文字（视觉上仍在输入区内）。

> 这三条必须先做 M0 打样再定，不要先写死。

### 4.4 采纳

```ts
const span = inputActions.captureInsertion()
const ok = inputActions.insertText(text, span)
```

- `insertText` 是**可撤销的纯文本编辑**，且带 revision 校验；期间用户改过草稿则返回失败，此时静默隐藏即可。
- 插入后不发送、不提交；回车仍由用户自己按。
- 插入后若编辑器未聚焦，需要把焦点交回输入框（具体入口待确认，必要时由 ghost 元素卸载前调用）。

### 4.5 键盘拦截

- 在 `window` 上用 **capture** 阶段监听 `keydown`，只在 `shown` 状态生效。
- 作用域判定：ghost 元素所在卡片必须包含 `document.activeElement`，否则不拦截，避免影响其他面板。
- `Tab` 在宿主里还被斜杠菜单（settle completion）和焦点切换使用。仅在"ghost 可见 + 草稿为空 + 无菜单"时拦截；任一条件不满足立即放行。
- 拦截后 `preventDefault()` + `stopPropagation()`，避免触发焦点跳转。

### 4.6 客户端状态

```ts
type GhostState =
  | { kind: 'idle' }
  | { kind: 'requesting'; seq: number; controller: AbortController }
  | { kind: 'shown'; seq: number; text: string }
```

- 缓存键：`${sessionId}:${lastSeq}`。同一回合不重复请求。
- 草稿一旦非空：取消请求、清空状态。
- 组件卸载 / 会话切换：abort。

---

## 5. Host 端设计

### 5.1 服务

`promptSuggestion`，暴露一个方法给 Client：

```ts
suggest(
  agent: Agent,
  request: { sessionId: SessionId; draft?: string; limit?: number },
  signal: AbortSignal,
): Promise<{ suggestions: string[]; provider: string; model: string; latencyMs: number }>
```

- 鉴权与参数形态参照 `commands.execute(agent, …)` 的 Remote 入口约定（待确认插件侧注册形式）。
- `draft` 非空时直接返回空数组（v1 不处理补全）。
- 失败返回空数组并记录原因，不向 UI 抛错。

### 5.2 上下文构建

1. `const session = ctx.sessions.get(sessionId)`；不存在则返回空。
2. `session.deriveMessages()`：取最近 `maxContextTurns`（默认 8）轮。
3. 过滤 `system` / `developer` 消息——它们和本次预测无关，且会显著抬高成本。
4. `tool` 消息只保留 `工具名 + 结果首行`，截断到 200 字符。
5. 每条消息截断到 `maxCharsPerMessage`（默认 1200），总字符上限约 16000（超出从最旧开始丢）。
6. 最后一条通常是 assistant 消息；不做任何改写。

### 5.3 模型选择

优先级：

1. Config 中显式配置的 `provider` + `model`。
2. 当前会话实际使用的模型：`session.requestHeader()?.header.config`。
3. 全局默认：`ctx.agentDefaultModel.currentSelection()`。

建议默认使用便宜、快的模型；这是辅助功能，不值得占用主力推理模型。

调用参数：

```ts
ctx.llm.stream({
  provider, model,
  system: SYSTEM_PROMPT,
  messages,
  temperature: 0.5,
  maxTokens: 48,
  stop: ['\n'],
  signal,
})
```

只需累加 `text-delta`，`finish` 后停止。

### 5.4 Prompt

```
你是一个对话输入预测器。用户正在和一个编码 Agent 对话。
根据对话历史，预测用户接下来最可能输入的一条消息。

规则：
- 只输出这一条消息本身：不要解释、不要引号、不要编号、不要前缀。
- 使用对话的主语言。
- 不超过 70 个汉字，或 40 个英文单词。
- 具体、可执行；优先"推进当前任务"的下一步动作。
- 如果助手最后一句是在向用户提问，直接给出用户最可能的回答。
- 不要重复历史中已经出现过的用户消息。
```

解析：

1. 取第一行非空文本。
2. 去掉包裹的引号、反引号、`- ` / `1. ` 等前缀。
3. 长度 > 200 字符或为空 → 丢弃。
4. 与最近 5 条用户消息完全相同 → 丢弃（允许编辑后仍有用，但完全重复没意义）。
5. 最多返回 `maxSuggestions`（默认 1）条。

### 5.5 Config

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 全局开关 |
| `provider` / `model` | 空 | 覆盖默认模型 |
| `maxContextTurns` | `8` | 上下文轮数 |
| `maxCharsPerMessage` | `1200` | 单条消息截断 |
| `temperature` | `0.5` | |
| `maxTokens` | `48` | |
| `debounceMs` | `250` | 回合结束后延迟，给用户"马上要打字"留出窗口 |
| `minIntervalMs` | `1000` | 同会话最小间隔 |
| `maxSuggestions` | `1` | v1 固定 1 |
| `showOnAssistantQuestion` | `true` | 助手提问时是否预测"回答" |

配置通过 `cordis.patch.yml` 修改，用户层可覆盖、可随升级保留。

---

## 6. 通信

首选：插件 Host 服务注册为 Client 可调用的 Remote 入口（与 `ctx.remote.commands.execute()` 同类路径）。

待确认：第三方 bundle 声明 Remote 的具体形式（typert 注册 / 控制器服务）。如果这条链路在插件侧不可用，退路：

- `ctx.webServer.register()` 挂一个同源 `POST /api/prompt-suggestion`，Client 直接 `fetch`，带 `sessionId` 与 AbortSignal。
- 功能等价，代价是少一层类型与统一的 peer 校验，需要自己校验 sessionId 属于当前 peer。

**M0 必须先验证这条链路**，它决定 Host 代码的形态。

---

## 7. 时序

```
用户发送 ──► 助手流式回复 ──► turn/end(completed)
                                  │
                         Client 观察到最后 assistant 已结算且 idle
                                  │ debounce 250ms
                                  ▼
                       草稿仍为空? ──否──► 放弃
                                  │是
                                  ▼
                     Host.suggest(sessionId)  ──► 读 Session / 调模型
                                  │
                     ≤ 700ms 且仍满足条件?
                                  │是
                                  ▼
                             显示 ghost
                                  │
                    Tab/→ ──► insertText ──► 光标在末尾，等待 Enter
```

---

## 8. 边界与失败处理

| 情况 | 处理 |
| --- | --- |
| 模型超时 / 报错 / 限流 | 静默丢弃，不显示任何错误；下轮再试 |
| 用户已开始输入 | abort 请求；已返回结果也丢弃 |
| 用户在请求期间切换会话 | abort；结果按 sessionId 校验后丢弃 |
| ghost 显示时来了新回合 | 立即隐藏 |
| 插入时 revision 已变 | `insertText` 返回 false，隐藏即可 |
| 会话处于审批 / 提问 / 计划确认 | 不请求 |
| 输入法组合中 | 不显示、不拦截按键 |
| 一次回复产生多条 assistant 消息 | 以最后一条结算为触发点，只触发一次 |
| 空会话 / 第一条消息前 | 不预测（无上下文） |

---

## 9. 埋点与评估

### 离线（上线前，最重要）

用真实会话回放：对每条 `user/message`，只用它之前的上下文预测一次，统计：

- top-1 完全匹配率
- 前缀匹配率（预测是实际输入的前缀）
- 语义相似度（可用 embedding 或简单 token F1）
- 平均延迟、平均 token 消耗

这一步能在不打扰任何人的情况下把 prompt 调到可用区间。

### 在线

| 事件 | 字段 |
| --- | --- |
| `shown` | sessionId, seq, provider, model, latencyMs, text |
| `accepted` | 同上 + 从显示到采纳的毫秒数 |
| `dismissed` | 同上 + 原因（esc / typing / turnChange / unmount） |

核心指标：**采纳率 = accepted / shown**。低于 10% 说明时机或内容不对，不要靠"用户还没习惯"解释。

埋点不写会话日志；v1 可只写 Host 侧结构化日志，后续再考虑落盘。

---

## 10. 风险与待验证

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `InputActions.captureInsertion()` / `insertText()` | 已核实 | 官方文档明确其语义：可撤销、revision 校验 |
| `conversation.input.overlay` slot 与标准 props | 已核实 | 含 `useInput` / `inputActions` / `sessionId` |
| 主题 token | 已核实 | 使用 `--dsw-alias-label-secondary` 等，无 tertiary 级文本 token |
| 插件 Host → Client 的 Remote 注册 | **待打样** | 决定 Host 代码形态；有 webServer 退路 |
| ghost 与原生 placeholder 叠字 | **待打样** | 主要视觉风险，三种方案见 4.3 |
| Tab 键冲突 | 中风险 | 需与斜杠菜单、焦点切换共存；必要时只保留 `→` |
| ghost 精确定位 | 中风险 | 依赖编辑器坐标，需 ResizeObserver + 字体变化重测 |
| `InputState` 具体字段名 | 待确认 | 文档只给出类型名；实现前用 inspection/源码确认 |
| 每次预测的延迟 | 低风险 | 独立小请求，通常 0.5–2s；超过 700ms 不显示 |

---

## 11. 里程碑

| 阶段 | 产出 | 预估 |
| --- | --- | --- |
| M0 打样 | 在真实页面验证：overlay 定位、placeholder 处理、Tab 拦截、`insertText` 生效、Host Remote 链路 | 0.5 天 |
| M1 Host | `promptSuggestion` 服务、上下文裁剪、模型调用、Config | 1 天 |
| M2 Client | ghost 组件、状态机、键位、采纳/忽略、会话开关 | 1 天 |
| M3 评估 | 离线回放脚本 + prompt 调优 | 0.5–1 天 |
| M4 收尾 | 埋点、设置项、图标与文案、打包安装 | 0.5 天 |

M0 不通过就不进入 M1：定位和键位是这件事能不能成立的前提。

---

## 12. 待决问题

1. ghost 是否允许**点击采纳**？建议不允许——点击输入区本来用于定位光标，抢这个交互会破坏肌肉记忆。
2. 输入框未聚焦时是否显示？建议显示（用户回到窗口就能看到），但不拦截键位。
3. 是否需要在"助手提问"时给 3 个候选？v1 先单条，看采纳率再决定。
4. 会话级开关放在哪里：输入卡片右侧的控制行（`conversation.input.right`），还是设置页统一管理？v1 建议设置页 + 一个 `/suggest off` 之类的命令，避免往工具栏塞东西。

---

## 13. 实现状态（0.1.0）

### 已实现

- Host 路由：`POST /prompt-suggestion/suggest`、`GET /prompt-suggestion/models`。
- 设置命名空间 `prompt-suggestion`：`enabled`、`systemPrompt`、`provider`、`model`、`maxContextMessages`、`maxTokens`，全部 volatile，改动即时生效、不重挂插件。
- 设置页：注册在 `settings.section`（导航顺序 25），复用 DSH 的 `configForms`，包含启用开关、模型下拉（留空跟随会话，带手动输入回退）、上下文条数、系统提示词编辑与恢复默认、保存/放弃、只读与失败提示。
- 模型调用顺序：设置覆盖 → 会话已提交模型 → 进程默认模型。
- 其余（ghost、回合边界、同源校验、超时、客户端重试）同 0.1.0。

### 关键实现细节

- 设置字段必须 `.volatile()`：`settings.describe()` 只投影 volatile 字段，非 volatile 的条目会被整体跳过。这是第一次接入时设置页显示“不可用”的原因。
- volatile 字段在 `apply` 里是 accessor 而不是值：每次请求都用 `resolveSettings(config)` 现读，才能拿到最新值。
- 用 `ctx.settings.configure({ auto: false }, ctx.fiber)` 关掉 Plugins 页的自动表单，避免与自有页面重复。
- 设置页不直接 `require` 官方 primitives，而是复刻它的标记与 CSS：36×20 开关、34px 输入框、13px 标签 / 12px 提示 / 14px 引言 / 16px 标题、`.5px border-l4` 边框、字段间 `border-l2` 分隔线、官方保存按钮。
- Client 源码按 ghost / settings / 组件 / 样式拆在 `client/`，由 `scripts/build-client.mjs`（esbuild）打成单个 classic bundle `client.js`；DSH 只加载后者，因此构建产物必须与源码一起提交。
- 模型目录通过 Host 的 `llm.listProviders()` + `llm.listModels()` 汇总，缓存 60 秒。
- 预测长度上限 70 个汉字 / 40 个英文单词；`maxTokens` 默认 256，给 reasoning 和长句留余量。
- ghost 最多 3 行：按工具栏上沿动态计算可用高度做行数裁剪，避免盖住工具栏。

### 已验证

| 项 | 结果 |
| --- | --- |
| Config schema | `status: schema`，6 个字段与默认值正确 |
| 设置条目进入 describe | ns = `prompt-suggestion`，`auto: false`，6 个 key |
| 写入与持久化 | `settings.update` 后 profile patch 生成 `- id: prompt-suggestion` 覆盖行，值立即变为 12，无需重启 |
| 模型目录 | 10 个模型，覆盖 deepseek-official / deepseek-account / magpie |
| 设置页导航 | `settings.section` 出现 `prompt-suggestion`，active |
| ghost slot | `conversation.input.overlay` 出现 `prompt-ghost` |
| 设置页视觉 / 保存按钮 | **未验证**（无受控浏览器） |
| ghost 视觉 / Tab 插入 | **未验证** |

### 仍待处理

1. **视觉验证**：设置页与 ghost 都需要人工看一眼。
2. **Client 刷新**：页面可能需要刷新一次才能拿到最新的客户端包。
3. **依赖**：插件现在依赖 `@deepseek-ai/schemastery`（已装进 `node_modules`）；打包分发时需一并安装。
4. 没有埋点；会话级开关仍缺。

---

## 14. 源码结构

```text
.
├── client/                     # Client 源码（ESM，按职责拆分）
│   ├── entry.cjs               # bundle 入口：CJS 导出 apply / inject
│   ├── index.js                # 只负责 slots / locale / configForms 注册
│   ├── constants.js            # 端点、超时、selector、命名空间
│   ├── locales.js              # zh / en 设置页文案
│   ├── ghost.js                # 输入框 ghost 预测
│   ├── settings.js             # 设置页
│   ├── components/
│   │   └── dropdown-select.js  # 自定义模型下拉
│   └── styles/
│       ├── ghost.js            # GHOST_CSS
│       └── settings.js         # SETTINGS_CSS
├── scripts/
│   └── build-client.mjs        # esbuild 构建 client.js
├── locale/                     # 插件元信息 zh / en
├── index.js                    # Host 半部
├── client.js                   # 构建产物，勿直接编辑
├── cordis.patch.yml
├── icon.svg
└── package.json
```

**边界约定**

- `client/` 是唯一手写的客户端源码；`pnpm build` 通过 `scripts/build-client.mjs` 生成根目录 `client.js`。
- DSH 的 `dsh.client` 加载协议是 classic script + `window.__ModuleLoader__.load({ id, factory })`，不解析发布包里的相对 ESM；因此不能让 `exports` 直接指向 `client/index.js`。
- `client/entry.cjs` 只做 CJS 适配，让 factory 返回 plain `{ apply, inject }`，与 DSH 官方客户端 bundle 的导出形态一致。
- 样式以 CSS 字符串模块放在 `client/styles/`，避免引入额外的 CSS loader；新增组件按 `components/` / `styles/` 归类，新增文案同时补 `locales.js` 的 `zh` 与 `en`。
