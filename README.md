# dsh-prompt-suggestion

给 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 用的输入预测插件：每轮回复结束后，在输入框里用灰色 ghost 文本提示你下一句可能想说什么。按 `Tab` 或 `→` 填入草稿，**只填入，不发送**。

## 功能

- **回合结束后预测**：不做逐字补全，只在助手回复完成、输入框为空时请求一次。
- **使用真实上下文**：优先保留最近的用户需求与助手回复；长正文保留首尾，工具结果只保留缩写，控制成本。
- **允许没有建议**：上下文不足或没有明确下一步时可返回空；重复历史用户输入和泛泛的「继续」不会展示。
- **可配置**：启用开关、预测模型、上下文消息条数、系统提示词。
- **按会话控制**：输入框工具栏可关闭当前会话的自动预测；需要时点「生成建议」或按 `Alt+Shift+P` 手动生成。`/suggest` 与 `/autopredict` 指令提供同样的两个入口。
- **不污染会话**：预测只存在于界面，不写入 Session 日志，也不注入模型上下文。
- **键盘优先**：`Tab` / `→` 采纳，`Esc` 忽略；开始输入或输入法组合时自动消失。

## 环境要求

- DSH Desktop，或 `dsh web`（旧版本写作 `dsh --profile web`）
- 从 GitHub 安装时，Host 所在机器需要能访问 GitHub
- 一个可用的模型 provider（默认跟随当前会话）

## 安装

插件是标准 DSH bundle（`dsh.bundle.patch` + `dsh.client`），仓库的 `build/` 已包含构建好的 Host 和 Client，不需要先发布到 npm，直接在 DSH 里从 GitHub 地址安装即可。用户无需安装 TypeScript、手动构建或批准本插件的构建脚本。

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
4. 如需减少自动调用，在输入框工具栏关闭本会话的「自动预测」。开关按会话保存在当前浏览器，刷新后保留；其他会话不受影响。输入框为空、无附件且助手空闲时，可点「生成建议」，或让输入框获得焦点后按 `Alt+Shift+P`。手动生成同样只展示 ghost；全局关闭插件预测时，手动入口也关闭。
5. 也可以直接用指令：输入 `/` 后选「生成建议」（`/suggest`）或「自动预测」（`/autopredict`）。两者都是客户端动作，不会作为消息发送；`/autopredict` 会打开「开启 / 关闭」选择，并标出本会话当前状态。

预测不保证每轮都有结果。没有足够依据、没有明确下一步，或候选重复历史用户输入时，输入框保持正常状态，不展示 ghost，也不会因为空结果自动重试。自定义提示词可输出 `NO_SUGGESTION` 表示本轮不提供建议；服务端的重复与泛泛建议过滤仍然生效。

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
- **Client**：源码按职责拆在 `src/client/`（`ghost/`、`settings/`、`dsh/` 等），由 esbuild 打成 DSH 加载的 classic bundle `build/client.js`；在 `conversation.input.overlay` 中渲染 ghost，按输入框原生 placeholder 的矩形与字体对齐；采纳走 `inputActions.captureInsertion()` + `insertText()`。
- **回合边界**：只接受以 `turn/end(completed)` 收尾的会话；`error` / `aborted` 不预测。
- **过期结果保护**：请求和回包都核对会话与回合；开始输入、中文输入法组合、切换会话或关闭功能时立即作废旧预测。
- **失败降级**：超时、限流、解析失败一律静默返回空，不影响正常输入。

## 项目结构

```text
src/
├── host/                      # DSH 注册、HTTP、预测规则、模型目录
├── shared/                    # 接口契约、设置默认值、超时预算
└── client/
    ├── ghost/                 # 预测状态控制、React hook、展示
    ├── settings/              # 设置逻辑与 TSX 页面
    ├── dsh/                   # 宿主接口类型与 DOM 兼容适配
    ├── components/            # 通用界面组件
    ├── styles/                # 插件 CSS
    └── index.ts               # slots / locale / configForms 注册
scripts/                       # 双端构建、安装包验证
tests/                        # 规则、HTTP、异步状态与 DOM 交互测试
docs/                          # 设计与贡献文档
├── DESIGN.md                  # 架构、生命周期和兼容约束
└── CONTRIBUTING.md            # 开发流程与 PR 规范
build/                         # 已构建并提交，供 DSH 安装后直接加载
├── index.js                   # Host ESM bundle
└── client.js                  # Client classic bundle
```

`build/index.js` 和 `build/client.js` 都由 `src/` 构建生成并提交到 Git。DSH 安装的是仓库对应的包，再按 `package.json` 的 `exports` 加载入口，不会固定查找根目录的 JS 文件：

```json
{
  "exports": {
    ".": "./build/index.js",
    "./client": "./build/client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["build/", "cordis.patch.yml", "locale/*.json", "icon.svg"]
}
```

`build/` 不能加入 `.gitignore`，否则从 GitHub 安装时拿不到预构建文件。无需 `prepare` / `postinstall` 构建，也无需用户安装开发工具。运行时依赖仍只有 `@deepseek-ai/schemastery`；React 由 DSH 提供。

项目首页保留在根目录 `README.md`，其他项目文档集中在 `docs/`。当前架构、生命周期和兼容约束见 [DESIGN.md](./docs/DESIGN.md)。

## 已知限制

- 一次只给一条候选；不支持点击采纳（点击输入区用于定位光标）。
- ghost 的可见行数取决于输入框可用高度，超长预测会被裁剪。
- 没有埋点，采纳率需要手动观察或自行加日志。
- 每次预测会多消耗一次模型调用（上下文约 3–5k token）。

## 开发

要求 Node.js 22.12+（推荐 `.node-version` 的 Node.js 24）和 pnpm 11.25.0。pnpm 版本由 `packageManager` 固定。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 监听 Host / Client 源码并重新生成两个 bundle |
| `pnpm typecheck` | TypeScript 严格类型检查 |
| `pnpm lint` / `pnpm lint:fix` | Biome 静态检查与格式化 |
| `pnpm test` / `pnpm test:watch` | Vitest 行为测试与交互测试 |
| `pnpm build:check` | 在内存中重建并核对产物，不改写文件 |
| `pnpm test:package` | 打包、只安装运行时依赖，验证 Host 导出及 Client 加载协议 |
| `pnpm check` | 顺序运行类型、静态检查、测试、产物一致性及安装包验证 |

源码在 `src/`；不要直接编辑 `build/` 的生成文件。改动后运行 `pnpm build` 并提交两端产物。为节省 GitHub Actions 额度，仓库已关闭自动 CI；提交前请在本地执行 `pnpm check`，核对源码与仓库中的预构建文件一致，并完成类型、静态检查、测试和安装包验证。

- Host 改动：构建后重启 DSH，或在插件列表停用再启用。
- Client 改动：构建后重新启用插件；必要时刷新页面。`pnpm dev` 负责重建，宿主重载仍由 DSH 管理。
- 单元和 DOM 测试使用受控的模型与宿主接口，不需要 API key；`test:package` 需要 npm registry 访问以安装运行时依赖。
- 真实模型预测、宿主界面的明暗主题和视觉对齐仍需在 DSH 中人工验收；DOM 测试不能替代这些检查。

贡献流程与 PR 规范见 [CONTRIBUTING.md](./docs/CONTRIBUTING.md)。

## License

[MIT](./LICENSE)
