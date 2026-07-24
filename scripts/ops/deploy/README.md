# YidaLab production deploy

目标：**少在服务器上冷编**。依赖层能缓存就缓存；有条件时本地 / CI 出镜像再上线。

## 时间预期

| 方式                                  | 典型耗时                               |
| ------------------------------------- | -------------------------------------- |
| 服务器 **带缓存** 重建（只改代码）    | 5–15 分钟                              |
| 服务器 **无缓存** 冷构建              | 25–45 分钟（国内源）/ 更久（官方 npm） |
| **镜像 ship**（`docker load` + `up`） | 1–5 分钟                               |

生产机建议：`USE_CN_MIRROR=true`，**默认不要** `--no-cache`。

## 路径 A：本机推源码 → 服务器带缓存 build（日常）

在 **本机仓库根**（有 `git` / `sshpass` 或已配好 SSH key）：

```bash
export DEPLOY_HOST=root@116.205.229.31
# export SSHPASS=...   # 若用密码
./scripts/ops/deploy/ship-from-local.sh
```

默认：

1. `git archive` 当前 HEAD
2. 上传并解压到服务器 `/yida/yidalab/src`
3. `docker compose build lobe`（**带缓存**，国内源）
4. `docker compose up -d lobe`

强制冷构建（排障用）：

```bash
NO_CACHE=1 ./scripts/ops/deploy/ship-from-local.sh
```

## 路径 B：已在服务器上，只 rebuild

```bash
ssh root@116.205.229.31
cd /yida/yidalab
./scripts/ops/deploy/server-rebuild.sh            # 缓存
NO_CACHE=1 ./scripts/ops/deploy/server-rebuild.sh # 冷构建
```

## 路径 C：编好镜像再上线（最快上线，推荐常发版时）

### C1. 无镜像仓库：save /load

本机若是 **arm64 Mac**，必须指定 `linux/amd64`（qemu 会慢，适合 CI 更合适）：

```bash
# 本机
docker buildx build --platform linux/amd64 \
  --build-arg USE_CN_MIRROR=true \
  -t yidalab:v1 --load .

docker save yidalab:v1 | gzip > /tmp/yidalab-v1.tar.gz
scp /tmp/yidalab-v1.tar.gz root@116.205.229.31:/tmp/
ssh root@116.205.229.31 'gunzip -c /tmp/yidalab-v1.tar.gz | docker load && cd /yida/yidalab && docker compose up -d lobe'
```

### C2. 有镜像仓库（ACR / GHCR）

```bash
docker buildx build --platform linux/amd64 \
  --build-arg USE_CN_MIRROR=true \
  -t registry.cn-xxx.aliyuncs.com/yida/yidalab:v1 --push .

# 服务器
docker pull registry.cn-xxx.aliyuncs.com/yida/yidalab:v1
docker tag registry.cn-xxx.aliyuncs.com/yida/yidalab:v1 yidalab:v1
cd /yida/yidalab && docker compose up -d lobe
```

`compose` 里 `image: yidalab:v1` 已固定，pull/tag 后直接 `up` 即可。

## 服务器约定

| 路径                      | 用途                                |
| ------------------------- | ----------------------------------- |
| `/yida/yidalab`           | 部署根：compose、`.env`、nginx      |
| `/yida/yidalab/src`       | 构建上下文（Dockerfile + monorepo） |
| `/yida/yidalab/build.log` | 最近一次 build 日志                 |

FBA 隧道：`systemctl status fba-tunnel`（`host.docker.internal:8090`）。
