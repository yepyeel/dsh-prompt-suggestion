# Contributing

## 开始之前

- 文档、样式微调可以直接提 PR。
- 行为变化、新设置项、新运行时依赖，先开 Issue 说明动机和取舍，再动手。
- 安全问题请私下联系维护者。

## 本地环境

- Node.js 22.12+，推荐 `.node-version` 的 Node.js 24。
- pnpm 11.25.0，由 package.json 的 packageManager 固定。
- 进行实际插件验收时需要 DSH Desktop 或 `dsh web`。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

`pnpm check` 依次执行 TypeScript、Biome、Vitest、构建产物比对与安装包检查。单元和 DOM 测试无需模型 API key。安装包检查会在临时目录仅安装运行时依赖，需要访问 npm registry。

## 日常开发

```bash
pnpm dev           # 监听双端 TypeScript / TSX 源码并重建
pnpm test:watch    # 按测试文件或过滤条件迭代
pnpm lint:fix      # 格式与可安全修复的检查
```

源码位于 src/host、src/client 和 src/shared。build/index.js 与 build/client.js 是 DSH 构建产物，不能直接编辑。提交时运行 pnpm build 并同时提交两端产物；build:check 在内存中比对，不改写文件。build/ 必须保留在 Git 中，package.json 的 exports 和 files 指向这些产物，保证从 GitHub 安装时无需用户构建。

本地目录通过 DSH 插件页以 link 方式安装。构建后停用再启用；Host 改动也可重启 DSH，Client 缓存或样式未更新时刷新页面。watch 负责构建，宿主负责重载。

## 代码边界

- host/index.ts 和 client/index.ts 只负责 DSH 注册。业务规则、HTTP、状态控制与 DOM 适配分别放入对应模块。
- 配置和接口使用 shared 契约与默认值；浏览器不能引入 Node-only 或 Host 模块。
- DSH 接口子集放在各自的 dsh 模块中。优先使用公共接口，不要 require Harness 内部 Client 包。
- 不把 React 打进 Client bundle；由 DSH 提供。新增运行时依赖需说明体积与兼容影响。
- 设置字段声明 volatile，在每次请求现读 accessor；不能在 apply 中保存快照。
- 预测控制器不依赖 React、DOM 或真实模型；回包检查会话、回合与请求身份，计时器和监听器必须可清理。
- HTTP 校验与未知异常集中处理。正常失败静默降级，诊断只记原因与耗时，不记会话内容或凭据。
- 不向 Session 写入预测或自定义事件，不将预测注入模型上下文。
- 界面文案同时维护 src/client/locales.ts 中的 zh / en 字典。

## 测试与验收

修复问题时优先增加复现行为测试，使用受控模型流与宿主接口。测试放在 tests/host 或 tests/client；键盘与设置交互用 React + jsdom，取消/超时用 fake timers。

DSH classic loader 的 apply/inject 形态、公开 exports、files 与 GitHub 免构建安装都属于兼容契约。拆模块后必须通过 test:package。CI 在 Node.js 22 / 24 上执行 pnpm check。

实际宿主验收包括：插件启用无错误、设置保存与恢复、ghost 显示、Tab/→ 填入不发送、Esc 和 IME、会话切换、明暗主题。UI 改动附截图或录屏，明确区分实际浏览器与 jsdom 验证。

## 分支与 PR

- 分支使用 feat/、fix/、refactor/、chore/ 或 docs/。
- 提交遵循 Conventional Commits，subject 不超过 72 字符。
- 一个 PR 解决一个问题，说明行为、兼容范围与实际验证，关联已有 Issue。
- 行为或结构变更同步更新 README / DESIGN。
- 不提交 node_modules、coverage、.scratch 或本地凭据。
- 默认 squash merge；收到反馈后在原 PR 分支继续提交。
