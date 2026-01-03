# Change Log

All notable changes to the "rightcode-bar" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.5]

- 新增命令：`RightCode: Add Account`（用户名/邮箱 + 密码登录获取 token）
- 迁移：`rightcodeBar.token` 自动迁移到 `rightcodeBar.accounts`（alias: `default`）

## [0.0.4]

- 配置改为仅 settings.json：支持多账号 `rightcodeBar.accounts` + `rightcodeBar.activeAccount`
- 移除 cookie / SecretStorage（不再提供安全输入命令）
- 缩减包体积：优化图标尺寸，更新 `.vscodeignore`

## [0.0.3]

- Activity Bar 新增 `RightCode` 侧边栏入口（Dashboard Webview）
- Dashboard：接入「我的订阅」接口，支持多订阅左右切换与手动刷新
- Dashboard：接入 Token 使用统计（按天/按小时、快捷范围、60s 自动刷新）并展示分布/表格
- 修复 Activity Bar 图标空白显示（新增带透明通道的图标资源）
- UI：订阅卡片/饼图/表格更紧凑，并优化窄宽度下的布局与溢出表现

## [0.0.2]

- Status bar subscription display + hover table tooltip
- Secure token/cookie storage via VS Code SecretStorage
- CI: package VSIX, publish to Marketplace, upload GitHub Release assets
