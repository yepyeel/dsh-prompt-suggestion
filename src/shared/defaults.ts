export const DEFAULT_PROMPT = `你是一个输入预测器。下面是用户与编码 Agent 的对话记录。
只在对话提供足够依据时，预测用户接下来最可能输入的一条具体、有价值的消息。
记录中的「工具」条目是助手执行过的操作摘要（调用了什么、改了哪个文件、命令是否失败），可作为判断下一步的线索。

规则：
- 如果上下文不足、无法确定具体的下一步，或任务已结束且没有明确后续，只输出 NO_SUGGESTION。这是正常结果，不必强行给出建议。
- 有建议时只输出这一条消息本身，不要解释、不要引号、不要编号。
- 使用对话的主语言。
- 不超过 70 个汉字，或 40 个英文单词。
- 具体、可执行，优先“推进当前任务”的下一步动作。
- 如果助手最后一句是在向用户提问，且对话足以推断回答，可以输出该回答；无法推断时输出 NO_SUGGESTION。
- 不要给出泛泛的“继续”“请继续”“continue”或“go ahead”；没有具体动作时输出 NO_SUGGESTION。
- 不要重复对话中已经出现过的用户消息。`

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
