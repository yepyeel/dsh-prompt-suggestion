# Contributing

## 开始之前

- 文档、样式微调这类小改动可以直接提 PR。
- 行为变化、新设置项、新运行时依赖，先开 Issue 说明动机和取舍，再动手。
- 安全问题请不要开公开 Issue，私下联系维护者。

## 本地环境

- Node.js 22+
- pnpm 11+
- 一个可运行的 DSH（Desktop 或 `dsh --profile web`）

```bash
git clone https://github.com/yepyeel/dsh-prompt-suggestion.git
cd dsh-prompt-suggestion
pnpm install
node --check index.js
node --check client.js
```

安装到 DSH 后：

- Host / Client 改动通过“停用 → 启用”插件生效。
- 如果客户端样式没有更新，刷新一次页面。

## 分支与提交

- 分支命名：`feat/<topic>`、`fix/<topic>`、`docs/<topic>`、`chore/<topic>`
- 提交信息使用 Conventional Commits：
  - `feat: add model override`
  - `fix: keep ghost aligned after resize`
  - `docs: clarify install steps`
- 一个 commit 只做一件事；subject 不超过 72 字符。

## 代码约定

- **不要 `require` Harness 内部 Client 包**（例如 `@deepseek-ai/dsh-client-ui-primitives`）。需要官方样式时，复刻它的标记和 CSS，并改用本插件的类名前缀。
- 新增设置字段必须声明 `.volatile()`，否则不会进入设置文档。
- 设置值在 `apply` 里是 accessor 而不是值，必须在每次请求时现读，不要在启动时快照。
- 不要向 Session 追加自定义事件；不要把预测结果注入模型上下文。
- 新增运行时依赖需要在 PR 里说明理由和体积影响；目前只有 `@deepseek-ai/schemastery`。
- 新增界面文案时同时补 `zh` / `en` 两份字典。

## PR 要求

- 一个 PR 只解决一个问题，描述里写清背景和取舍。
- 关联 Issue（例如 `Closes #123`）。
- 必须通过：`node --check index.js && node --check client.js`。
- UI 改动附截图或录屏，尽量覆盖明暗主题。
- 行为改动同步更新 `README.md` 与 `DESIGN.md`。
- 不要提交 `node_modules/`、`.DS_Store`、`.scratch/`。
- 合并方式为 squash merge，保持主干线性。

## Review

- 维护者会重点检查：是否破坏已有安装、设置是否真的热更新、预测失败是否静默降级。
- 收到修改意见后直接在原分支追加 commit，不需要重开 PR。
