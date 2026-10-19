## 改动内容

<!-- 一句话说明这个 PR 做了什么，以及为什么 -->

## 关联 Issue

Closes #

## 验证方式

<!-- 说明你实际怎么验证的，不要只写“已测试” -->

- [ ] `pnpm build`
- [ ] `pnpm check`
- [ ] `client.js` 是从 `client/` 重新构建的
- [ ] 安装/启用后 Host 无报错
- [ ] 设置页可以读取并保存
- [ ] ghost 能显示，`Tab` / `→` 能填入且不发送

## 截图 / 录屏

<!-- UI 改动请附上，尽量包含明暗主题 -->

## 检查清单

- [ ] 没有提交 `node_modules/`、`.DS_Store`、`.scratch/`
- [ ] 没有引入 Harness 内部 Client 包
- [ ] 新增设置字段是 volatile，并且在每次请求时现读
- [ ] 文案同时补了 `zh` / `en`
- [ ] 文档已同步（README / DESIGN）
