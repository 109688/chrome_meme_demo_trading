# GMGN Paper Trade

Chrome / Edge 扩展：在 [GMGN](https://gmgn.ai) 代币页用虚拟 USDT 模拟 meme 买卖，不连接钱包、不发起真实链上交易。

**版本：** 1.7.1 · Manifest V3

[English](./README.en.md)

## 功能

- 虚拟资金账户（默认 10,000 USDT），本地持久化
- 市价买 / 卖（可配置滑点、手续费）
- 自定义买入 / 卖出快捷百分比（如 `25,50,100`）
- 限价卖单（现价 ≥ 目标价自动触发）
- 持仓、成交、挂单列表
- 当日盈亏与总权益展示
- 价格 / 浮盈 / 盈亏%：**强制实时刷新**（主世界 DOM 心跳 + Dex 持续报价 + 面板直接重绘）
- 状态固定显示「实时跟价」，不再双源来回闪
- 有现价即可立即买卖

## 支持站点与链

| 站点 | 说明 |
|------|------|
| `https://gmgn.ai/*` | 主站 |
| `https://www.gmgn.ai/*` | 主站 |
| `https://gmgn.gracematrix.net/*` | 镜像 |

链：Solana、BSC、Robinhood、Base、ETH、Monad、Tron、Blast、Arc、Stable 等（按 GMGN 代币页 URL 识别）。

## 安装

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库目录（含 `manifest.json` 与 `content.js` 的文件夹）
5. 打开任意 GMGN **代币详情页**，硬刷新（`Ctrl+F5`）

**成功标志：**

- 页面顶部短暂出现橙色提示：`GMGN 模拟交易 v1.7.1 已注入`
- 右下角出现橙色浮动按钮；点击或按 `Alt+P` 打开面板
- 控制台有日志：`[GMGN Paper Trade] script loaded ... v1.7.1`

## 使用

1. 进入 GMGN 的 `/{chain}/token/...` 页面，面板显示 **实时跟价** 且有价格后即可交易
2. 输入买入金额（USDT）或点快捷 %，点击买入（立即成交，无等待倒计时）
3. 买入后价格 / 浮盈 / 盈亏% 随页面现价实时跳动
4. 卖出用持仓比例快捷键或限价卖单
5. 设置里可调滑点 (bps)、手续费 (bps)、初始资金与买卖快捷 %
6. 点面板 `↺` 可重置账户（清空持仓、挂单与成交）

数据保存在页面 `localStorage`（键名 `gmgn_paper_trade_v1`），清除站点数据会丢失模拟账户。

## 目录结构

```
extension/
├── manifest.json   # MV3 清单
├── page-hook.js    # 页面主世界：拦截 GMGN fetch/XHR 报价
├── content.js      # 隔离世界：面板 UI 与模拟成交
├── README.md       # 中文
└── README.en.md    # English
```

## 权限说明

- **content_scripts**：仅在上述 GMGN 域名注入脚本
- **host_permissions**：读取 GMGN 页面 / API，以及 `https://api.dexscreener.com/*` 拉取报价

本扩展**不会**请求钱包授权，也**不会**广播真实交易。

## 免责声明

仅供学习与模拟练习，不构成任何投资建议。模拟成交价格与真实成交可能存在偏差；请勿将本工具用于真实资金决策。

## License

MIT
