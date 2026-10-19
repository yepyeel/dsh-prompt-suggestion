export const DEFAULT_PROMPT = `你是一个输入预测器。下面是用户与编码 Agent 的对话记录。
请预测用户接下来最可能输入的一条消息。

规则：
- 只输出这一条消息本身，不要解释、不要引号、不要编号。
- 使用对话的主语言。
- 不超过 70 个汉字，或 40 个英文单词。
- 具体、可执行，优先“推进当前任务”的下一步动作。
- 如果助手最后一句是在向用户提问，直接给出用户最可能的回答。
- 不要重复对话中已经出现过的用户消息。`

export const SETTINGS_NS = 'prompt-suggestion'
export const LOCALE_NS = 'settings.promptSuggestion'
export const ROUTE = '/prompt-suggestion/suggest'
export const MODELS_ROUTE = '/prompt-suggestion/models'
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
