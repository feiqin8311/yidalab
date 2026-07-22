# YidaLab

Internal AI agent workspace, forked from [LobeHub](https://github.com/lobehub/lobehub).

**Repo:** <https://github.com/feiqin8311/yidalab>\
**Chinese:** [README.zh-CN.md](./README.zh-CN.md)

## What this is

YidaLab is a company-facing customization of LobeHub:

- DingTalk free-login / bot gateway
- Dingpan (钉盘) tools and HTML export upload
- Redis internal jobs by default (QStash optional)
- Product branding, service-model, and access gates for internal pilot

Not the upstream public product. Do not use LobeHub marketing badges / Discord / Product Hunt links as if they apply here.

## Docs (start here)

| Doc                                                                                            | Purpose                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [docs/development/yidalab-ops-checklist.md](./docs/development/yidalab-ops-checklist.md)       | Deploy / DingTalk / bot / schedule checklist |
| [docs/development/pilot-invite.md](./docs/development/pilot-invite.md)                         | Internal pilot invite copy                   |
| [docs/development/basic/setup-development.mdx](./docs/development/basic/setup-development.mdx) | Upstream-style local stack notes             |

## Local development

```bash
# deps + infra (Postgres / Redis / …) — see docs above
pnpm install
bun run dev:docker # if you use compose infra
bun run db:migrate

# full stack (Next API ~3010 + SPA)
bun run dev

# SPA only (Vite, proxies API to localhost:3010)
bun run dev:spa
```

Typical URLs:

- App / API: `http://localhost:3010`
- SPA dev: `http://localhost:9876`
- LAN share: use your machine IP, e.g. `http://192.168.x.x:9876` (set `APP_URL` if auth callbacks must match)

## YidaLab env (minimum)

See the ops checklist for the full list. Common ones:

```bash
# public URL (DingTalk / auth callbacks)
APP_URL=http://localhost:3010

# DingTalk free-login
AUTH_DINGTALK_APP_KEY=
AUTH_DINGTALK_APP_SECRET=
AUTH_DINGTALK_CORP_ID=
# AUTH_DINGTALK_AGENT_ID=

# optional: browser only inside DingTalk
# NEXT_PUBLIC_DINGTALK_ONLY=1

# optional: disable bot stream in local dev
# ENABLE_BOT_IN_DEV=0

# optional: turn off anonymous product telemetry
# TELEMETRY_DISABLED=1
```

## Branch

Default product branch for this fork: `main` on `feiqin8311/yidalab`.\
Upstream LobeHub development lives on their `canary` (tracked as `upstream`).

## License / upstream

Based on LobeHub (see [LICENSE](./LICENSE)).\
Upstream project: <https://github.com/lobehub/lobehub>
