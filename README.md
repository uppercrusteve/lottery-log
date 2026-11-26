# lottery-log

每天买过的彩票记一笔，开奖后自动判中没中、中几等奖、多少钱。数据存在你自己的私有 GitHub 仓库里，没有服务端，没有账号系统。

目前覆盖**双色球**和**大乐透**。竞彩足球/篮球在 [docs/竞彩数据源.md](docs/竞彩数据源.md) 里做完了数据源侦察，模型预留了 `kind: 'parlay'`，尚未实现。

- Web：浏览器直接开，可装到桌面
- Android：Capacitor 外壳，可自己打 debug apk 侧载
- 不做 iOS（签名麻烦）

## 它做什么

| 做 | 不做 |
| --- | --- |
| 记下你买的号、金额、倍数、追加 | 不代购、不预测、不给推荐号 |
| 每晚从福彩/体彩官方接口抓开奖 | 抓不到就写 `pending`，绝不猜号 |
| 按官方奖级表判中奖等级 | 浮动奖缺当期金额时标"待官方公布"，不填 0 |
| 按票面与开奖号染色对照 | 不做"附近开奖"之类的软文案 |

**判定结果仅供参考**，以彩票实物和官方公告为准。

## 怎么用自己的

### 1. 建一个私有数据仓

新建一个 **private** 仓库，比如 `你的名字/lottery-log-data`。空仓即可，App 会自己建目录。

### 2. 发一个 fine-grained PAT

只给这一个数据仓，权限只要 **Contents: Read and write**。别的都不要给。

在 App 右上角齿轮里填账号、仓库名、token。token 只存在本机 IndexedDB，不进任何网络请求的 URL（走 `Authorization` 头）。换机或怀疑泄露就点「清除凭据」，再回 GitHub 吊销重发。

### 3. 用

网页版直接开就行；手机装 apk 更顺手。

## 本地跑

```bash
npm ci
npm run dev      # 开发，默认 5173
npm test         # 单测
npm run build    # 产出 dist/
```

## 打 Android apk

先装 JDK 21 和 Android SDK（`platforms;android-35`、`build-tools;35.0.0`），然后：

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug        # Windows: gradlew.bat
# 产物在 android/app/build/outputs/apk/debug/app-debug.apk
```

**坑**：工作区路径里有中文时 AGP 解析 SDK 会挂（`文件名、目录名或卷标语法不正确`）。把工程复制到纯 ASCII 路径（如 `F:\ll-build`）再构建。另外 `android/local.properties` 里的 `sdk.dir` 用正斜杠，别用反斜杠。

## 开奖抓取怎么跑

官方接口没有 CORS 头，浏览器直连会被拦，所以抓取放 GitHub Actions（境外 IP，能直连）：

- `.github/workflows/fetch-draws.yml`：每天 21:45 与 22:15（北京时间）各跑一次，抓不到写 `pending`
- 需要在本仓库 Settings → Secrets 里配 `DATA_REPO_TOKEN`，是一个能写数据仓的 PAT

手动补抓：

```bash
node scripts/fetch-draws.mjs 2026-11-25
```

## 数据长什么样

一天一个文件，`tickets/YYYY-MM-DD.json` 和 `draws/YYYY-MM-DD.json`。按日期分片是为了两台设备改不同天时不打架；同一天撞车时按 id 合并，删除用 `removed` 墓碑记住，409 会自己重读重试。

格式由 `core/codec.js` 管，带 `schema` 版本号，有迁移函数。

## 分层

```
core/        纯函数，零 IO 零 DOM（规则、判定、编解码）
adapters/    存储与凭据（GitHub、IndexedDB、内存）
app/         编排：合并、冲突重试、离线队列
ui/          界面，只调 app/
```

`core/` 不认识 GitHub、不认识 IndexedDB，换成别的后端只动 `adapters/`。详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 已知限制

- 只算 90 分钟比分（竞彩阶段用）
- 浮动奖（双色球一/二等奖、大乐透一/二等奖）只取当期官方公布值
- 大乐透追加只影响浮动奖的 80%，不参与固定奖判级
- 抓取失败需要人工补，没有"重试到成功"的兜底
- debug apk 未签名发布版，装的时候要允许未知来源

## 许可

MIT
