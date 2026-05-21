# tools020_MediaRecorder

本项目用于采集浏览器麦克风语音。当前已完成客户端，后续服务端可以放在根目录下独立扩展。

## 目录结构

```text
.
├── .env.example          # 服务端本地配置示例
├── client/               # React + TypeScript + Vite 客户端
│   ├── .env.example      # Vite 客户端配置示例
│   └── src/
└── package.json          # 根目录转发脚本
```

## 客户端技术栈

- React
- TypeScript
- Vite
- Tailwind CSS
- MediaRecorder API
- navigator.mediaDevices.getUserMedia
- @huggingface/transformers
- OpenAI Whisper ASR
- fetch
- React useState / useRef

## 已实现页面

- 音频采集：浏览器麦克风录音，每次采集会追加到采集列表，支持历史播放、下载、删除、上传和转到转换页。
- 音频转换：选择本机音频文件，或直接使用“音频采集”页面选中的历史录音，通过浏览器端 Whisper 模型转写为文本。

音频转换页默认使用 `Xenova/whisper-tiny` 的标准 `fp32` 权重，也可以切换到 `Xenova/whisper-base`。首次转换时浏览器会下载并缓存模型文件，后续加载会更快。

## 本地配置

环境变量只保留两份模板，由 `start.ps1` / `start.bat` 在首次启动时自动复制：

| 模板 | 生成后 | 用途 |
|------|--------|------|
| `.env.example` | `.env` | API 服务（`server/index.mjs`） |
| `client/.env.example` | `client/.env` | 前端开发（Vite） |

线上 EdgeOne 构建不在仓库里放 `.env.production`，在 Gitee 流水线变量里配置 `VITE_UPLOAD_ENDPOINT`（有 API 时）。

## 启动

一键启动：

```powershell
.\start.bat
```

双击 `start.bat` 也可以启动。脚本会自动复制缺失的 `.env` 文件、安装客户端依赖，并启动客户端开发服务。

如果你更习惯 PowerShell，也可以执行：

```powershell
.\start.ps1
```

手动启动：

```powershell
npm --prefix client install
npm run client:dev
```

也可以直接进入客户端目录：

```powershell
cd client
npm run dev
```

## 构建

```powershell
npm run client:build
```

## CI/CD（Gitee → EdgeOne）

配置在 `.workflow/tools020-master-pipeline.yml`，分为两阶段：

| 阶段 | 触发 | 作用 |
|------|------|------|
| **CI-构建** | 推送 Tag `v1.1.1` 格式自动 | 编译前端，产出 `dist` |
| **CD-发布EdgeOne** | **手动点击** | 部署到 EdgeOne |

**打 Tag 自动构建：**

```powershell
git tag v1.1.1
git push origin v1.1.1
```

**手动发布：** 构建成功后，在 Gitee 流水线该次运行里点击 **「CD-发布EdgeOne（手动）」** 阶段执行。

**首次在 Gitee 启用（只做一次）：**

1. 打开 [流水线](https://gitee.com/chenwl888/tools020_-media-recorder/gitee_go/pipelines)
2. **从代码库同步 YAML**（`.workflow/tools020-master-pipeline.yml`）
3. 事件监听：Tag 正则 `^v[0-9]+\.[0-9]+\.[0-9]+$`，可关闭分支匹配
4. 变量里添加 `EDGEONE_API_TOKEN`（手动发布阶段必填）

**流水线变量（在 Gitee 网页设置，不能写进 git）：**

| 变量 | 必填 | 说明 |
|------|------|------|
| `EDGEONE_API_TOKEN` | 发布时必填 | EdgeOne Pages → API Token |
| `EDGEONE_PROJECT_NAME` | 否 | 默认 `tools020-media-recorder` |
| `VITE_API_BASE_URL` | 否 | 有公网 API 时写入生产构建 |

> Gitee Go **没有**开放「修改流水线 YAML」的 HTTP API，配置以仓库 `.workflow/tools020-master-pipeline.yml` 为准；推送后请在流水线页 **从代码库同步**。

如果日志里出现 `mvn -B clean package` 或 `there is no POM in this directory`，说明当前运行的是 Gitee 网页里残留的 **Java Maven** 流水线，不是本仓库的 Node.js YAML。请在 Gitee Go 里同步仓库 YAML，并禁用或删除旧的 Maven 流水线。

如果日志里出现 `onnxruntime-node` 下载失败，说明客户端依赖安装时执行了 Node 后端的安装脚本；当前流水线已使用 `npm ci --prefix client --ignore-scripts`，前端构建只需要浏览器端依赖。

日常：改代码 → `commit` → `push master`。

## CI/CD（GitHub → EdgeOne）

配置在 `.github/workflows/ci.yml`，分为三个 job：

| Job | 触发 | 作用 |
|-----|------|------|
| **build** | 仅 Tag `v*.*.*`（如 `v1.2.3`） | 编译前端，产出 `client/out` 与 `dist` |
| **deploy** | 同上 Tag 推送 | 部署到 EdgeOne |
| **release** | 同上 Tag 推送 | 创建 GitHub Release |

> `push main`、Pull Request **不会**触发本 workflow。Dependabot 的「Dependabot Updates」是 GitHub 自带，与 CI/CD 无关。

**打 Tag 自动构建并发布：**

```bash
git tag v1.1.1
git push origin v1.1.1
```

**首次在 GitHub 启用（只做一次）：**

任选一种部署方式（在仓库 **Settings → Variables** 设置 `EDGEONE_DEPLOY_MODE`）：

**方式 A：`git`（默认，适合已关联 GitHub 的项目 `tools120-media-recorder`）**

- EdgeOne 已绑定本仓库，生产分支设为 `main`
- 打 Tag 后 CI 会向 `main` 推一次空提交，触发 EdgeOne **自动从 GitHub 拉代码**并按根目录 `edgeone.json` 构建
- **不需要** Webhook，也**不能**对 Git 项目使用 `edgeone pages deploy` 上传 dist

**方式 B：`upload`（须单独建「直接上传」项目）**

1. EdgeOne 控制台 → 创建项目 → 选 **直接上传**（不要选导入 GitHub）
2. 记下项目名，在 GitHub 设置：
   - Variable `EDGEONE_DEPLOY_MODE` = `upload`
   - Variable `EDGEONE_UPLOAD_PROJECT_NAME` = 直接上传项目名
   - Secret `EDGEONE_API_TOKEN` = API Token
3. 打 Tag 后 CI 用 CLI 上传 GitHub Actions 构建好的 `dist`

| 配置项 | 方式 A (git) | 方式 B (upload) |
|--------|--------------|-----------------|
| `EDGEONE_DEPLOY_MODE` | `git`（可省略） | `upload` |
| `EDGEONE_UPLOAD_PROJECT_NAME` | — | 直接上传项目名 |
| `EDGEONE_API_TOKEN` | — | 必填 |
