# YidaLab production deploy

**日常发版：服务器不编译。** push 代码 → GitHub Actions 构建镜像 → SSH 推到生产机重启。

## 日常路径（唯一推荐）

```bash
# 本机
git push origin main # 或 codex/yidalab-custom
# 打开 Actions → 「YidaLab Production Image」
# 成功后生产已自动更新（约 15–25 分钟，主要是 CI 编译）
```

| 步骤 | 在哪          | 做什么                                                                |
| ---- | ------------- | --------------------------------------------------------------------- |
| 1    | GitHub runner | `docker build` linux/amd64 → 推 `ghcr.io/feiqin8311/yidalab:prod`     |
| 2    | runner → 116  | `docker save \| gzip \| ssh` 灌进服务器，**不在服务器上 pull / 编译** |
| 3    | 服务器        | `docker tag … yidalab:v1` + `compose up --no-build`                   |

Workflow：`.github/workflows/yidalab-prod-image.yml`\
Secrets（已配）：`PROD_SSH_HOST` / `PROD_SSH_USER` / `PROD_SSH_PASSWORD`

手动只重部署已有 tag（不重建）：Actions → **YidaLab Prod Deploy (GHCR → server)** → 填 `prod` 或 `sha-xxxxxxx`。

### 时间预期

| 方式                          | 典型耗时                                 | 服务器 CPU |
| ----------------------------- | ---------------------------------------- | ---------- |
| **push → CI 构建 + SSH 部署** | **15–25 min**（CI 编译）+ 1–3 min 传镜像 | 几乎不占   |
| 服务器 `server-rebuild`       | 15–45 min                                | 打满       |
| 服务器 GHCR `pull`（可选）    | 1–5 min                                  | 低         |

生产 compose 已是 **`image: yidalab:v1` + `pull_policy: never`**，没有 `build:`。

---

## 服务器上手动脚本

| 脚本                   | 用途                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `server-pull-image.sh` | 从 GHCR pull → tag → up（需 `read:packages` 或包公开）                 |
| `server-rebuild.sh`    | **兜底**；默认拒绝，需 `CONFIRM_SERVER_BUILD=1` 且 compose 有 `build:` |
| `remote-pull-image.sh` | 本机 SSH 触发服务器 pull                                               |

```bash
# 服务器（可选；日常不必）
cd /yida/yidalab
TAG=prod ./server-pull-image.sh
```

GHCR 若 403：包是 private 时 PAT 要有 `read:packages`，或把 Package 设为 Public。\
**日常不依赖服务器 pull**——CI 用 SSH 流式灌镜像。

---

## 兜底：本机打包到服务器编译（不推荐）

```bash
export DEPLOY_HOST=root@116.205.229.31
# 仅在 CI 挂了、且 compose 临时加回 build: 时使用
CONFIRM_SERVER_BUILD=1 ./scripts/ops/deploy/ship-from-local.sh
```

---

## 服务器约定

| 路径                | 用途                                  |
| ------------------- | ------------------------------------- |
| `/yida/yidalab`     | compose、`.env`、nginx、部署脚本      |
| `/yida/yidalab/src` | 仅服务器编译兜底时需要；日常可忽略    |
| `image: yidalab:v1` | compose 本地名；CI/pull 后 tag 成这个 |

FBA：`systemctl status fba-tunnel`（容器经 `host.docker.internal:8090`）。
