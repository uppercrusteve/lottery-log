# 架构

## 一句话

`core/` 是能整块搬到别的记账 App 里的纯逻辑；GitHub 只是当前选的一种存储后端，不是架构的一部分。

## 分层与依赖方向

```
ui/  ──▶  app/  ──▶  core/
            │
            └──▶  adapters/  ──▶  core/codec
```

箭头单向。`core/` 只 import 自己。

| 层 | 有什么 | 不许有什么 |
| --- | --- | --- |
| `core/` | 规则表、判定、金额、分片编解码、校验 | `fetch`、`indexedDB`、`document`、时间以外的环境依赖 |
| `adapters/` | GitHub Contents API、IndexedDB 镜像、内存桩、凭据 | 业务判断（中没中奖不在这层决定） |
| `app/` | 合并、冲突重试、离线入队、时间线组装 | DOM |
| `ui/` | 渲染与事件 | 直接调 `adapters/`（除凭据表单） |

`adapters/store/contract.js` 是存储契约，四个方法：读/写票单分片、读/写开奖分片、列日期。任何后端实现这四个方法就能插进来。

## 为什么这么切

原始的硬约束是"这套东西以后还要做一个账本 App"。账本和彩票的差别在规则表，不在存储和同步。所以判定规则做成可替换的模块，存储做成契约，两边都不认识对方。

`core/verdict.js` 只接收 `(ticket, draw)`，返回 `{level, amount, pending, reason}`。它不知道票是从 GitHub 还是 IndexedDB 读来的。

## 存储

数据在私有仓，一天一个分片：

```
tickets/2026-11-26.json
draws/2026-11-26.json
```

**按日期分片**，不是为了好看：两台设备改不同日期时 SHA 不冲突，各推各的，不会互相打回。

同一天撞车时：

1. 本地先落盘（断网也不丢）
2. 推远端，409/422 抛 `ConflictError`
3. 重读远端，按 `id` 合并，重推，最多 3 次
4. 仍失败就进 `outbox` 队列，UI 明确标"记在本机了"

合并规则：`id` 去重、后写覆盖、`removed` 墓碑取并集且优先。墓碑必须存，否则删掉的票会在下一次合并时被远端并回来——这一条有单测盯着。

## 开奖数据

抓取在 GitHub Actions 里跑，不在客户端：

- 官方接口（`cwl.gov.cn`、`webapi.sporttery.cn`）不发 CORS 头，浏览器直连被拦
- Actions 是境外 IP，能直连这两个域名

抓不到就写 `status: 'pending'` 并记下错因。判定遇到 pending 返回 `pending: true`，UI 显示"待开奖"，绝不因为缺数据就当成没中。

浮动奖金（双色球一/二等奖、大乐透一/二等奖）只能来自当期开奖的 `prizeTable`。缺失时 `amount: null`，理由是"浮动奖，缺当期金额"。固定奖查表，不依赖网络。

## 凭据

fine-grained PAT，只给单个私有仓的 contents 读写。

- 存本机 IndexedDB，不同步、不上传
- 请求走 `Authorization: Bearer`，**不放 URL**（避免进 Referer 和日志）
- 有「清除凭据」出口
- 数据仓私有时，token 泄露 = 数据泄露，所以权限范围要卡死到单仓

## 为什么不用 TWA

TWA 要求站点有可验证的 Digital Asset Links，还得挂着域名；本地 `file://` 或局域网跑不起来。Capacitor 打出来的是自带 WebView 的 apk，装完就能用，不依赖任何域名。

## 移植成别的 App

1. `core/rules/` 换成新规则，`models.js` 改实体
2. `core/verdict.js` 改判定
3. `codec.js` 换分片结构，`SCHEMA` 加版本，写迁移
4. `adapters/` 和 `app/` 的合并逻辑基本照抄
5. `ui/` 重做

存储、同步、冲突处理这三块不用动。
