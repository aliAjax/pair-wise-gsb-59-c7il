# 公共采购技术响应符合性评审平台

基于 Angular、PrimeNG、NgRx、Angular Router、Apollo Angular、GraphQL、Nx 和 TypeScript 实现。前端不会用普通 JSON 占位接口，而是通过 Apollo Angular 对本地 GraphQL mock server 发起真实查询和 mutation。

## 功能

- 评审概览：否决项遗漏、评审覆盖、评分分歧、逾期澄清、重复证明和当前版本。
- 条款评审：技术条款树、供应商响应、证明文件、独立评审意见、评分和澄清发起。
- 批量比对：动态供应商列、评分差异定位、证明复用提示和差异筛选。
- 小组复核：保留各评审员独立意见，显示评分区间和分歧处理队列。
- 澄清轮次：发起澄清、登记回复、轮次和期限校验，未完成项目阻止定稿。
- 评审版本：按当前修订号定稿，冻结供应商响应、独立评审意见和澄清记录快照，生成可复算的 SHA-256 内容哈希并支持在线复算校验。
- 定稿门禁：否决项必须凑齐两名评审员结论（符合/偏离），未完成澄清仍然拦截。
- 并发控制：所有写操作携带基准修订号；并发提交冲突时保留尝试与冲突清单，可基于最新修订号重发；定稿期间晚到的提交不改写冻结版本，自动并入下一工作版并写审计。
- 角色分权：采购人员、评审员 A、评审员 B 和评审组长的操作入口按角色限制。
- 审计导出：GraphQL mutation 和版本操作写入审计日志（含修订号），支持 JSON、CSV 导出。

## 技术栈

- Angular 22 standalone
- PrimeNG 22
- NgRx Store / Effects
- Angular Router
- Apollo Angular + GraphQL
- Nx workspace
- TypeScript 6
- Apollo Server 5 mock schema/server

## 本地 GraphQL

mock server 位于 `server/`，GraphQL 地址为 `http://127.0.0.1:18462/graphql`。schema 和 resolver 定义在 `server/schema.ts`、`server/server.ts`，初始数据位于 `server/data.ts`，定稿快照与哈希逻辑位于 `server/versioning.ts`，运行时 mutation 会写入被 Git 忽略的 `server/runtime-data.json`。

## 修订号与定稿

- 工作区维护单调递增的工作修订号（`currentRevision`），每次成功写入都会推进；审计日志按修订号留痕。
- 定稿把当前修订号刻进版本：冻结该批次的供应商响应、独立评审意见、澄清记录快照，`sha256(修订号 + 快照)` 即内容哈希，`verifyVersionHash` 可随时复算比对。
- 提交评审意见、发起/回复澄清必须携带 `baseRevision`：与当前修订号一致才写入；若基准修订号已定稿，提交并入下一工作版并补写审计；其余不一致返回 `REVISION_CONFLICT`（含冲突清单），前端保留本次尝试，可一键按最新修订号重发。

## 运行

```bash
npm install
npm run dev
```

- 前端：`http://localhost:18459`
- GraphQL：`http://127.0.0.1:18462/graphql`

## 构建

```bash
npm run build
```

构建由 `nx build procurement-review` 执行 Angular application builder，并包含 TypeScript 与 Angular 模板严格检查。
