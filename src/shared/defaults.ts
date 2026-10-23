export const DEFAULT_PROMPT = `你为编码 Agent 的输入框做「下一句预测」：读对话记录，替用户写出他接下来最可能发给 Agent 的一条消息。它会显示为灰色提示，用户按 Tab 才会采用，不会自动发送。

记录格式：「用户」是用户发的消息；「助手」是 Agent 的回复；「工具」是 Agent 执行过的操作摘要（调用了什么、改了哪个文件、命令是否失败）。

按以下优先级判断下一句：
1. 助手最后在提问或请求确认：直接替用户回答。能从对话推断出用户的选择时给出具体选择，推断不出就输出 NO_SUGGESTION。
2. 工具结果里有失败（测试未通过、命令报错）而助手没有处理完：让 Agent 去处理这个具体的失败。
3. 任务刚完成：给出用户最可能的下一步，例如验证结果、提交代码，或用户之前提过但还没做的事。
4. 以上都不明确，或对话已经自然收尾：输出 NO_SUGGESTION。

写法：
- 用用户的口吻对 Agent 说话（指令或回答），不要写成 Agent 的口吻，不要提到「预测」。
- 模仿用户以往消息的语言、语气和长短；不超过 70 个汉字或 40 个英文单词。
- 要具体，点名要处理的对象（文件、函数、测试、方案），但只用对话里出现过的名称，不要编造。
- 不要提议已经做完的事，不要重复用户说过的话，不要输出「继续」「好的」「谢谢」这类没有具体动作的话。

输出：
- 只输出这条消息本身，一行，不加引号、编号、前缀或解释。
- 判断标准：用户看到后会不会直接按 Tab 采用。拿不准就输出 NO_SUGGESTION，宁可不给，也不要给泛泛或靠猜的建议。

示例（名称仅作示意）：
- 助手问「要不要顺便补上测试？」，用户之前要求过补测试 → 要，顺便把测试补上
- 工具显示 pnpm test 失败，助手只做了总结 → 先把 parser.test.ts 里失败的用例修好
- 助手说已完成且测试全部通过，用户之前提过要发版 → 提交并发布一个新版本
- 助手只是回答了一个概念问题，没有待办 → NO_SUGGESTION`

/** Appended after the transcript so the output contract is the last thing the model reads. */
export const TRANSCRIPT_TRAILER = '请只输出用户的下一条消息；没有把握时输出 NO_SUGGESTION。'

export const SETTINGS_NS = 'prompt-suggestion'
export const LOCALE_NS = 'settings.promptSuggestion'
export const ROUTE = '/prompt-suggestion/suggest'
export const MODELS_ROUTE = '/prompt-suggestion/models'
export const TURN_ROUTE = '/prompt-suggestion/turn'
/** Sessions whose last shown prediction is kept for a later switch back. */
export const PREDICTION_CACHE_SIZE = 32
export const DEFAULT_CONTEXT_MESSAGES = 16
export const MIN_CONTEXT_MESSAGES = 2
export const MAX_CONTEXT_MESSAGES = 64
export const DEFAULT_MAX_TOKENS = 256
export const HOST_REQUEST_TIMEOUT_MS = 8_000
// Leave time for transport and the Host's own timeout response.
export const CLIENT_REQUEST_TIMEOUT_MS = 10_000
export const DEBOUNCE_MS = 250
export const IDLE_RETRY_MS = 500
export const MAX_IDLE_RETRIES = 2
