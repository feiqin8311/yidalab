# YidaLab v1.0-internal 放行检查表

> **口径**：内部生产可用（固定用户群），不承诺对外正式产品稳定性。\
> **主路径**：登录 → 对话干活 → 钉盘交付 → 可排障。\
> **规则**：下面全部勾完才能宣布上线；期间**不加新功能**。

关联：[部署注意](./yidalab-ops-checklist.md) · [试用邀请](./pilot-invite.md)

---

## 0. 发布单元（先收束，再验）

- [ ] 当前分支变更已 commit，并打 tag（建议 `v1.0.0-internal`）
- [ ] 生产已跑迁移（含 `company_feedback` 等新表）
- [ ] 生产 `APP_URL` 为公网 HTTPS；`REDIS_URL` + 队列模式按 [ops checklist](./yidalab-ops-checklist.md)
- [ ] 出问题可回滚到上一 tag / 上一镜像

---

## 1. 钉钉应用权限（两套应用，勿混）

### 1A. 免登应用（`AUTH_DINGTALK_*`）

- [x] `AUTH_DINGTALK_APP_KEY` / `SECRET` / `CORP_ID` 已配（可选 `AGENT_ID`）— 人工确认 2026-07-23
- [x] 钉钉工作台能打开并自动登录（至少 1 人非管理员）— 人工确认 2026-07-23

### 1B. 钉盘 OpenAPI 应用（公司凭证 key = `dingtalk`）

- [ ] 公司凭证已填：`DINGTALK_APP_KEY` + `DINGTALK_APP_SECRET`（设置 → 公司凭证 → DingTalk App）
- [x] 开放平台已开通钉盘权限（2026-07-23 冒烟验证）：
  - `Storage.File.Read` / `Storage.File.Write` / `Storage.UploadInfo.Read`（及上传 commit 所需项）
- [x] 公司凭证含 **operator** `DINGTALK_UNION_ID`（柯鹏翔）
  - 个人凭证只放 `DINGTALK_FOLDER_LINK`，**不要**放个人 UNION\_ID（会覆盖 operator 导致 403）
- [x] 自动冒烟：`node scripts/ops/smoke-dingpan-v1.mjs --members 柯鹏翔,李梦,Kevin` → `summary.gate === PASS`

**说明**：免登应用 ≠ 钉盘应用；密钥不要填反。

---

## 2. 凭证与人员 seed

- [ ] 公司 `dingtalk`：APP\_KEY/SECRET 在**生产库**可读（管理员打开公司凭证可见掩码 / 可更新）
- [ ] 每位试点成员个人 `dingtalk-dingpan` 具备：
  - [ ] `DINGTALK_FOLDER_LINK`（本人默认文件夹）
  - [ ] `DINGTALK_USER_ID` 或 `DINGTALK_UNION_ID`
  - [ ] **无**个人行残留的 `DINGTALK_APP_KEY` / `APP_SECRET`（避免覆盖公司密钥）
- [ ] 地图文件：`scripts/ops/dingpan-personal-folders.json`；seed：\
      `DINGTALK_APP_KEY=… DINGTALK_APP_SECRET=… node scripts/ops/seed-dingpan-folders.mjs`

---

## 3. 三人冒烟（硬门槛）

任选 **3 个账号**，其中至少 **1 个非管理员 / 非种子账号**。每人独立完成，**禁止代登**。

| 步骤 | 操作                                   | 通过标准                                                                                       |
| ---- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A    | 钉钉或浏览器登录                       | 进入首页，无白屏 / 死循环                                                                      |
| B    | 随便聊一轮                             | 模型正常回复                                                                                   |
| C    | 要求生成一份短 HTML 报告并「上传钉盘」 | 返回 **preview 链接**                                                                          |
| D    | 打开钉盘链接                           | 文件在本人默认目录下的 **`YYYY-MM-DD`** 子文件夹内                                             |
| E    | 看文件名                               | 形如 `{ASIN或关键词}_{站点?}_{任务}_{用户名}_{YYYYMMDD}.html`，**不是** Sunday/OpenClaw 等旧名 |
| F    | （可选）机器人单聊一句                 | 有回复；`/new` 能新开话题                                                                      |

记录表（复制到发布笔记）：

| 账号 | A 登录 | B 对话 | C 链接 | D 日期夹 | E 命名 | 备注 / 截图 |
| ---- | ------ | ------ | ------ | -------- | ------ | ----------- |
| 1    | ☐      | ☐      | ☐      | ☐        | ☐      |             |
| 2    | ☐      | ☐      | ☐      | ☐        | ☐      |             |
| 3    | ☐      | ☐      | ☐      | ☐        | ☐      |             |

**任一人 C/D 失败 → 不放行。** 先查：公司 app 密钥、个人 folder、开放平台权限、UNION\_ID。

---

## 4. 失败应可读（抽查 1 次即可）

- [ ] 临时清空测试号个人 `DINGTALK_FOLDER_LINK` 再上传 → 提示应指向「个人凭证 / 文件夹」，而非无意义堆栈
- [ ] 设置 → 凭证：公司 DingTalk App 与个人 DingTalk 分区清楚

---

## 5. 反馈与运营

- [ ] 固定反馈群 / 联系人（更新 [pilot-invite](./pilot-invite.md) 里的 xxx）
- [ ] 约定：反馈必带 **时间 + 操作步骤 + 截图 + 钉钉或浏览器**
- [ ] 站内反馈页（若启用）在生产可提交；或明确「只用群」
- [ ] 指定 1 名值班人（工作日看群）

---

## 6. 明确不做（v1.0-internal 冻结）

上线窗口内不新开：

- 新 Agent 能力 / 新 MCP / 新开关（Plan Mode 等未验主路径的可先藏或默认关）
- 新人自助接入产品化（v1.1）
- 对外文档 / 营销口径

---

## 7. 放行签名

| 项        | 填写                                 |
| --------- | ------------------------------------ |
| 版本 /tag |                                      |
| 生产域名  |                                      |
| 冒烟三人  |                                      |
| 放行人    |                                      |
| 日期      |                                      |
| 结论      | ☐ 放行　☐ 不放行（阻塞项：\_\_\_\_） |

**放行一句话**：三人主路径钉盘交付成功 + 发布可回滚 + 反馈渠道固定 → 可宣布 **v1.0-internal**。

---

## 附录：自动冒烟（2026-07-23，6/6 PASS）

全员：`node scripts/ops/smoke-dingpan-v1.mjs --members 柯鹏翔,邱文杰,柯芦轩,Kevin,Jasmin,李梦`

| 账号   | 默认目录 folderId | 日期夹       | 冒烟文件 fileId |
| ------ | ----------------- | ------------ | --------------- |
| 柯鹏翔 | 229795078298      | 229844360843 | 229844579908    |
| 邱文杰 | 229795184909      | 229845562208 | 229844896350    |
| 柯芦轩 | 229795179101      | 229844652811 | 229845079612    |
| Kevin  | 229795092687      | 229844988034 | 229845408639    |
| Jasmin | 229795058087      | 229844355557 | 229844425459    |
| 李梦   | 229830871746      | 229844172475 | 229845390342    |

预览：`https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=28859011990&fileId=<fileId>&type=file`

**结论**：钉盘主路径 **6/6 PASS**；免登 **已人工确认**；tag/release `v1.0.0-internal` 已发。\
仍待：§3 对话→Agent→钉盘（产品路径）、§4 失败可读、§5 反馈群 / 值班、§0 生产部署与迁移确认。
