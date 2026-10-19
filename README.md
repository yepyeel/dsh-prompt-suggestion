# dsh-prompt-suggestion

给 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 用的输入预测插件：每轮回复结束后，在输入框里用灰色 ghost 文本提示你下一句可能想说什么。按 `Tab` 或 `→` 填入草稿，**只填入，不发送**。

## 功能

- **回合结束后预测**：不做逐字补全，只在助手回复完成、输入框为空时请求一次。
- **使用真实上下文**：读取当前 Session 最近的若干条消息；工具结果只保留缩写，控制成本。
- **可配置**：启用开关、预测模型、上下文消息条数、系统提示词。
- **不污染会话**：预测只存在于界面，不写入 Session 日志，也不注入模型上下文。
- **键盘优先**：`Tab` / `→` 采纳，`Esc` 忽略；开始输入或输入法组合时自动消失。

## 环境要求

- DSH Desktop，或 `dsh --profile web`（需要 `settings.section` 与 `configForms` 服务）
- 一个可用的模型 provider（默认跟随当前会话）

## 安装

插件是标准 DSH bundle（`dsh.bundle.patch` + `dsh.client`），可以直接从仓库安装。

### 方式一：从 Git 仓库安装（推荐）

在 DSH 会话里让 agent 安装：

> 安装 https://github.com/yepyeel/dsh-prompt-suggestion

底层操作是 `plugin_manager install_bundle`，target 填上面的仓库地址。安装完成后插件默认启用，配置写入当前 profile。

### 方式二：本地目录

```bash
git clone https://github.com/yepyeel/dsh-prompt-suggestion.git
cd dsh-prompt-suggestion
pnpm install --prod
```

然后让 agent 用绝对路径安装：

> 安装 /path/to/dsh-prompt-suggestion

本地目录会以 `link:` 方式挂载；改动文件后，在插件列表里停用再启用即可生效。

## 更新

插件没有内置的自动更新，更新方式是「移除 + 重新安装」。

### 从 Git 安装的用户

在 DSH 会话里说：

> 更新 dsh-prompt-suggestion

对应的操作：

1. `plugin_manager list_bundles` 找到该包的 `source`；
2. `remove_bundle` 卸载；
3. `install_bundle` 用同一个 `source` 重装；
4. 如果返回 `restart-required`，重启 DSH。

重新安装会重新解析 Git 地址并拿到最新提交；设置覆盖行按插件 id 记录，不会因为重装丢失。

### 本地 link 安装的用户

```bash
git pull
```

然后在插件列表里停用再启用；Host 改动需要重启 DSH。

### 建议固定版本

安装时带上 tag，升级时再显式换掉：

> 安装 https://github.com/yepyeel/dsh-prompt-suggestion#v0.1.0

当前版本见 [Releases](https://github.com/yepyeel/dsh-prompt-suggestion/releases)。

## 使用

1. 正常发一条消息。
2. 助手回复结束、输入框为空时，输入框里会出现灰色预测。
3. 按 `Tab` 或 `→` 填入草稿，确认后自己按 Enter 发送；`Esc` 忽略。

## 设置

设置 → 输入预测：

| 项 | 说明 |
| --- | --- |
| 启用输入预测 | 关闭后不再请求预测，输入框不会出现提示 |
| 预测模型 | 默认跟随当前会话；也可以固定一个更便宜、更快的模型 |
| 上下文消息条数 | 送给模型的历史消息条数，2–64，默认 16 |
| 系统提示词 | 决定预测的语气、长度和方向；「恢复默认」会清除自定义 |

设置写入 profile 的 patch 覆盖行。字段声明为 volatile，保存后立即生效，不需要重启。

## 实现概览

- **Host**：`POST /prompt-suggestion/suggest` 读取 Session、裁剪上下文、调用 `ctx.llm.stream()`；`GET /prompt-suggestion/models` 汇总可用模型。
- **Client**：在 `conversation.input.overlay` 中渲染 ghost，按输入框原生 placeholder 的矩形与字体对齐；采纳走 `inputActions.captureInsertion()` + `insertText()`。
- **回合边界**：只接受以 `turn/end(completed)` 收尾的会话；`error` / `aborted` 不预测。
- **失败降级**：超时、限流、解析失败一律静默返回空，不影响正常输入。

更完整的设计与取舍见 [DESIGN.md](./DESIGN.md)。

## 已知限制

- 一次只给一条候选；不支持点击采纳（点击输入区用于定位光标）。
- ghost 的可见行数取决于输入框可用高度，超长预测会被裁剪。
- 没有埋点，采纳率需要手动观察或自行加日志。
- 每次预测会多消耗一次模型调用（上下文约 3–5k token）。

## 开发

```bash
pnpm install
node --check index.js
node --check client.js
```

- Host 改动：在插件列表里停用再启用，或重启 DSH。
- Client 改动：同样停用/启用；样式没更新时刷新页面。

贡献流程与 PR 规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE)
