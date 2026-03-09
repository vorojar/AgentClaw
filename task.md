# AgentClaw 待办

## Web 配置向导（高优先级）
- 首次访问检测无配置 → 重定向 `/setup` 向导页
- 分步引导：LLM API Key → 模型选择 → 渠道凭证（可跳过）→ 完成
- 配置存 SQLite settings 表，优先级：DB > .env
- Settings 页复用同一套字段，支持日常修改

## 一键安装脚本
- Linux/macOS：`curl | sh` 自动装依赖 + 创建 systemd 服务
- Windows：PowerShell 安装脚本
- Docker 已有，保持现状

## 多语言（i18n）
- Web UI + 系统提示词支持多语言切换
- Setup Wizard 首步选语言，存入 settings
- 至少支持中文、英文

## 自动更新
- 启动时检测新版本，Web UI 提示可更新
- 一键升级（拉取 + 重新构建 + 重启）

## API Key 加密存储
- SQLite settings 表中的敏感字段（API Key、渠道凭证）AES 加密落盘
- 运行时解密，密钥派生自机器指纹或用户设定的主密码

## 数据备份/恢复
- 一键导出（对话记录、记忆、设置、任务）为单文件
- 一键导入恢复，支持跨机器迁移

## 用户文档
- 面向终端用户的使用说明（安装、配置、功能介绍）
- 区别于开发者 README，放在 Web UI 内或独立站点

## 跨平台适配
- 启动时环境检测（OS、Shell、外部依赖 ffmpeg/python 等）
- 缺失依赖：终端提示 + Setup Wizard 环境检查清单（绿勾/红叉 + 一键安装）
- 各平台自动选包管理器（apt/brew/winget），Windows 可 fallback 下载到 data/bin/
- 重依赖（whisper/pytorch）做成可选功能，缺失时跳过并提示
