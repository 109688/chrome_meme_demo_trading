# GMGN Paper Trade

Chrome / Edge extension for paper-trading memes on [GMGN](https://gmgn.ai) with virtual USDT. No wallet connection, no real on-chain transactions.

**Version:** 1.4.0 · Manifest V3

[中文说明](./README.md)

## Features

- Virtual cash account (default 10,000 USDT), persisted locally
- Market buy / sell with configurable slippage and fees
- Customizable buy / sell quick percentages (e.g. `25,50,100`)
- Limit sell orders (auto-trigger when price ≥ target)
- Positions, trade history, and open orders
- Day P&amp;L and total equity
- Price sources (by priority): GMGN API → DexScreener → page DOM
- Draggable floating panel; `Alt+P` to show / hide

## Supported sites &amp; chains

| Site | Notes |
|------|--------|
| `https://gmgn.ai/*` | Main site |
| `https://www.gmgn.ai/*` | Main site |
| `https://gmgn.gracematrix.net/*` | Mirror |

Chains: Solana, BSC, Robinhood, Base, ETH, Monad, Tron, Blast, Arc, Stable, and more (detected from the GMGN token page URL).

## Install

1. Open `chrome://extensions` (Edge: `edge://extensions`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this repository folder (the one with `manifest.json` and `content.js`)
5. Open any GMGN **token detail page** and hard-refresh (`Ctrl+F5`)

**Success indicators:**

- Orange banner at the top: `GMGN 模拟交易 v1.4.0 已注入`
- Orange floating button at the bottom-right; click it or press `Alt+P` to open the panel
- Console log: `[GMGN Paper Trade] script loaded ... v1.4.0`

## Usage

1. Go to a GMGN `/{chain}/token/...` page and wait for the price to load
2. Enter a buy amount (USDT) or tap a quick %, then buy
3. Sell with position-ratio shortcuts or place a limit sell
4. In Settings, adjust slippage (bps), fee (bps), starting cash, and buy/sell quick %
5. Click `↺` on the panel to reset the account (clears positions, orders, and trades)

State is stored in page `localStorage` under `gmgn_paper_trade_v1`. Clearing site data will wipe the paper account.

## Layout

```
extension/
├── manifest.json   # MV3 manifest
├── content.js      # Injected logic & UI
├── README.md       # Chinese
└── README.en.md    # English
```

## Permissions

- **content_scripts**: Injects only on the GMGN hosts listed above
- **host_permissions**: Access to GMGN pages / APIs, plus `https://api.dexscreener.com/*` for quotes

This extension does **not** request wallet approval and does **not** broadcast real transactions.

## Disclaimer

For learning and paper trading only. Not investment advice. Simulated fills may differ from real market execution; do not use this tool for live-money decisions.

## License

MIT

我的GMGN UID：72957778 常用地址: 5fhDbDa81fPaBN6Zt2XKm2g9sPGgKi49AwpuuVpmhREb 记录我的从零到一的打狗之路
有用的话请加个 star⭐吧！我会持续更新更多链上交易，谢谢

My GMGN UID: 72957778 Common address: 5fhDbDa81fPaBN6Zt2XKm2g9sPGgKi49AwpuuVpmhREb Record my trading journey from zero to one
If useful, please add a star ⭐ Go ahead! I will continue to update more on chain transactions, thank you

x:@liu245456 tg：@BNB9919

MIT
