# rightcode-bar

在 VS Code 中展示你的 RightCode 订阅与使用情况：

- 右下角状态栏：显示当前订阅剩余额度（$）
- 左侧 Activity Bar：`RightCode -> Dashboard`（订阅卡片 + Token 使用统计）

## 功能

### 状态栏

- 显示：`<subscription_name> 剩余 $<remaining_quota>`（保留两位小数）；无订阅则显示 `当前暂无订阅`
- hover 提示：展示所有订阅的表格（当前用于展示的订阅会加粗；按 `total_quota - remaining_quota` 从小到大选择）
- 自动刷新：默认每 300 秒拉取一次；也可手动刷新

### Dashboard（RightCode）

- 我的订阅：支持多订阅左右切换；支持手动刷新
- Token 使用情况：按天/按小时 + 快捷范围（默认 7 天）；支持手动刷新与 60s 自动刷新
- Token 使用分布：模型占比 + 详细统计表

## 配置（用户设置 / 全局）

推荐使用安全命令（写入系统密钥链 / Keychain）：

- `RightCode: Set Token (Secure)`
- `RightCode: Set Cookie (Secure)`

也可以在 VS Code 用户设置中添加（不推荐：会明文写入 `settings.json`）：

- `rightcodeBar.token`: 用于 `Authorization: Bearer <token>`
- `rightcodeBar.cookie`: 用于请求的 `Cookie`（通常需要 `cf_clearance=...`）

命令面板：

- `RightCode: Refresh Subscription`
- `RightCode: Clear Token/Cookie (Secure)`
- `RightCode: Open Settings`

> 注意：token/cookie 属于敏感信息，请勿提交到仓库或截图公开。
