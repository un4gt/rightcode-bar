# rightcode-bar

在 VS Code 右下角状态栏展示 RightCode 订阅剩余额度，并在 hover 时以表格形式展示订阅详情。

## 功能

- 状态栏显示：`<subscription_name> 剩余 <remaining_quota>`（保留两位小数）；无订阅则显示 `当前暂无订阅`
- hover 提示：展示所有订阅的表格（当前用于展示的订阅会加粗；按 `total_quota - remaining_quota` 从小到大选择）
- 自动刷新：默认每 300 秒拉取一次；也可手动刷新

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
