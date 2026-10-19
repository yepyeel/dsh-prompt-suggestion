# dsh-prompt-suggestion

给 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 用的输入预测插件：每轮回复结束后，在输入框里用灰色 ghost 文本提示你下一句可能想说什么。按 `Tab` 或 `→` 填入草稿，**只填入，不发送**。

## 功能

- **回合结束后预测**：不做逐字补全，只在助手回复完成、输入框为空时请求一次。
- **使用真实上下文**：读取当前 Session 最近的若干条消息；工具结果只保留缩写，控制成本。
- **可配置**：启用开关、预测模型、上下文消息条数、系统提示词。
- **不污染会话**：预测只存在于界面，不写入 Session 日志，也不注入模型上下文。
- **键盘优先**：`Tab` / `→` 采纳，`Esc` 忽略；开始输入或输入法组合时自动消失。

## 环境要求

- DSH Desktop，或 `dsh web`（旧版本写作 `dsh --profile web`）
- 从 GitHub 安装时，Host 所在机器需要能访问 GitHub
- 一个可用的模型 provider（默认跟随当前会话）

## 安装

插件是标准 DSH bundle（`dsh.bundle.patch` + `dsh.client`），已经在仓库里带了构建好的 `client.js`，不需要先发布到 npm，直接在 DSH 里从 GitHub 地址安装即可。

### 从侧边栏安装（推荐）

1. 打开 DSH，在左侧侧边栏点 **插件**。
2. 点 **添加插件**。
3. 在输入框里填仓库地址：

   ```text
   https://github.com/yepyeel/dsh-prompt-suggestion
   ```

   也可以填 pnpm 的 GitHub 简写：`github:yepyeel/dsh-prompt-suggestion`。
4. 点 **安装**，等 pnpm 执行完成。
5. 按提示点 **立即启用**。如果安装结果提示需要重启 DSH，重启后再用。

插件安装到当前 profile，安装完成后默认启用。

> Git 地址不经过 npm 安装源，需要 Host 直接访问 GitHub（或配置代理）。如果提示「无法访问 GitHub」，先处理网络后重试。这个插件没有发布到 npm，所以不能改填包名。

### DSH Desktop

直接按上面的步骤在桌面 App 里安装：

- Desktop 自带 Node.js 和 pnpm，不需要另外装 pnpm。
- 插件由桌面 App 管理，装在 Desktop 的 profile 里。
- Desktop profile 不能用 `dsh plugin` 命令行管理；安装、卸载和更新都走侧边栏的插件页。

### dsh web

在运行 DSH 的机器上启动 Web：

```bash
dsh web
```

打开它输出的地址，然后同样在侧边栏 **插件 → 添加插件** 里填 GitHub 地址。

- Host 需要能找到 `pnpm`。先运行 `pnpm -v` 确认；没有的话先 `npm install -g pnpm`（或 `corepack enable`）。
- 安装发生在运行 `dsh web` 的机器上，不是打开浏览器的机器。远程访问时，pnpm 和 GitHub 网络都要在那台 Host 上可用。
- 插件装在 web profile 里。Desktop 和 web 的 profile 相互独立，两边需要分别安装。

### 从本地目录安装（开发）

```bash
git clone https://github.com/yepyeel/dsh-prompt-suggestion.git
cd dsh-prompt-suggestion
pnpm install
pnpm build
```

然后在 **插件 → 添加插件** 里填目录的绝对路径（例如 `/path/to/dsh-prompt-suggestion`）。本地目录会以 `link:` 方式挂载；改动文件后，在插件列表里停用再启用即可生效，Host 改动需要重启 DSH。

### 固定版本

安装时在地址后带上 tag，升级时再显式换掉：

```text
https://github.com/yepyeel/dsh-prompt-suggestion#v0.1.0
```

或 `github:yepyeel/dsh-prompt-suggestion#v0.1.0`。当前版本见 [Releases](https://github.com/yepyeel/dsh-prompt-suggestion/releases)。

## 更新

插件没有内置的自动更新，第三方插件在 DSH 里的升级方式就是「卸载 + 重新安装」。

### 从 GitHub 安装的用户

1. 在 **插件** 页找到 `dsh-prompt-suggestion`，卸载它。
2. 点 **添加插件**，重新填同一个 GitHub 地址并安装。
3. 如果提示需要重启 DSH，重启后生效。

重新安装会重新解析 Git 地址并拿到最新提交；设置覆盖行按插件 id 记录，不会因为重装丢失。Desktop 和 `dsh web` 使用各自的 profile，更新时也要分别操作。

### 本地 link 安装的用户

```bash
git pull
pnpm install
pnpm build
```

然后在插件列表里停用再启用；Host 改动需要重启 DSH。

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
- **Client**：源码按职责拆在 `client/`（`ghost.js`、`settings.js`、`components/`、`styles/` 等），由 esbuild 打成 DSH 加载的 classic bundle `client.js`；在 `conversation.input.overlay` 中渲染 ghost，按输入框原生 placeholder 的矩形与字体对齐；采纳走 `inputActions.captureInsertion()` + `insertText()`。
- **回合边界**：只接受以 `turn/end(completed)` 收尾的会话；`error` / `aborted` 不预测。
- **失败降级**：超时、限流、解析失败一律静默返回空，不影响正常输入。

## 项目结构

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

`client.js` 由 `client/` 构建生成；DSH 只加载这个 classic bundle，因此提交时两者必须保持同步。

更完整的设计与取舍见 [DESIGN.md](./DESIGN.md)。

## 已知限制

- 一次只给一条候选；不支持点击采纳（点击输入区用于定位光标）。
- ghost 的可见行数取决于输入框可用高度，超长预测会被裁剪。
- 没有埋点，采纳率需要手动观察或自行加日志。
- 每次预测会多消耗一次模型调用（上下文约 3–5k token）。

## 开发

```bash
pnpm install
pnpm build
pnpm check
```

`client.js` 是构建产物，源码在 `client/`；改完源码后运行 `pnpm build` 重新生成，不要直接编辑 `client.js`。

- Host 改动：在插件列表里停用再启用，或重启 DSH。
- Client 改动：构建后同样停用/启用；样式没更新时刷新页面。

贡献流程与 PR 规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE)
