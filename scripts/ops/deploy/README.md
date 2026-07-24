# YidaLab production deploy

目标：**服务器尽量不编译**。日常用 **CI 镜像 + pull**；没镜像时再用带缓存的服务器 build。

## 时间预期

| 方式                       | 典型耗时             |
| -------------------------- | -------------------- |
| **GHCR pull + up**（推荐） | **1–5 分钟**         |
| 服务器 **带缓存** 重建     | 5–15 分钟            |
| 服务器 **无缓存** 冷构建   | 25–45 分钟 +         |
| 本机 `docker save` 上传    | 视带宽，无服务器编译 |

服务器上 build 时：`USE_CN_MIRROR=true`，**不要**默认 `--no-cache`。

---

## 路径 0：GitHub Actions → GHCR → 服务器 pull（推荐）

Workflow：`.github/workflows/yidalab-prod-image.yml`

| 项       | 说明                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 触发     | push 到 `main` / `codex/yidalab-custom`，或 Actions 手动 **Run workflow** |
| 平台     | `linux/amd64`（与生产机一致）                                             |
| 镜像     | `ghcr.io/<owner>/yidalab:prod`、`:latest`、`:sha-<short>`                 |
| 构建位置 | GitHub runner（不占 116 CPU）                                             |

### 一次性配置

1. 仓库 **Settings → Actions → General → Workflow permissions → Read and write**
2. 第一次构建成功后：GitHub **Packages** 里找到 `yidalab` 包
   - Private 包：服务器用 PAT（`read:packages`）登录 GHCR
3. 服务器登录一次：

```bash
export GHCR_USER=feiqin8311
export GHCR_TOKEN=ghp_xxx # read:packages
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
```

### 每次发版

```bash
# 1. 等 Actions「YidaLab Production Image」成功
# 2. 服务器
cd /yida/yidalab
export TAG=prod # 或 sha-585b8d3
./server-pull-image.sh
```

本机远程执行：

```bash
export DEPLOY_HOST=root@116.205.229.31
export TAG=prod
export GHCR_USER=...
export GHCR_TOKEN=...
# export SSHPASS=...
./scripts/ops/deploy/remote-pull-image.sh
```

---

## 路径 A：本机推源码 → 服务器带缓存 build

```bash
export DEPLOY_HOST=root@116.205.229.31
./scripts/ops/deploy/ship-from-local.sh
```

冷构建：`NO_CACHE=1 ./scripts/ops/deploy/ship-from-local.sh`

---

## 路径 B：已在服务器上 rebuild

```bash
cd /yida/yidalab
./server-rebuild.sh
# NO_CACHE=1 ./server-rebuild.sh
```

---

## 路径 C：本机 / CI save 镜像（无 GHCR 时）

Mac 需 `--platform linux/amd64`（模拟会慢，更适合 CI）：

```bash
docker buildx build --platform linux/amd64 \
  --build-arg USE_CN_MIRROR=false \
  -t yidalab:v1 --load .
docker save yidalab:v1 | gzip | ssh root@116.205.229.31 'gunzip -c | docker load'
ssh root@116.205.229.31 'cd /yida/yidalab && docker compose up -d lobe'
```

---

## 服务器约定

| 路径                | 用途                                                    |
| ------------------- | ------------------------------------------------------- |
| `/yida/yidalab`     | compose、`.env`、nginx                                  |
| `/yida/yidalab/src` | 仅「服务器 build」时需要                                |
| `image: yidalab:v1` | compose 固定本地名；pull 后 `docker tag ... yidalab:v1` |

FBA：`systemctl status fba-tunnel`（容器经 `host.docker.internal:8090`）。
