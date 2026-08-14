# dsh app

Unofficial Windows desktop wrapper for [`dsh web`](https://www.npmjs.com/package/@deepseek-ai/dsh). This is a third-party shell, not an official DeepSeek product.

The product UI is the DeepSeek Harness browser UI. This host starts `dsh web` on `127.0.0.1`, waits until it serves HTML, and loads that origin in a native window. It does **not** vendor or freeze a `dsh` runtime.

## Clone and run

```bash
git clone https://github.com/OWNER/dsh-app.git
cd dsh-app
npm install
npm start
```

Requires a separately installed CLI: `npm install -g @deepseek-ai/dsh`. License: MIT (see [LICENSE](LICENSE)).

## 全新电脑怎么装

完整步骤见 **[docs/全新电脑安装.md](docs/全新电脑安装.md)**。顺序是：

1. 安装 [Node.js](https://nodejs.org/) LTS（18+）
2. `npm install -g @deepseek-ai/dsh`
3. 运行 **`dsh-app-setup.exe`**（安装）或 **`dsh-app.exe`**（便携）
4. 打开 **dsh app**

外壳和 CLI 分开：`npm update -g @deepseek-ai/dsh` 即可升级 `dsh`，不用重装桌面应用。

主窗口顶部栏和托盘都有 **插件广场**：浏览 Oh-DSH 使用的公开 [dsh-suite](https://github.com/whyihaveyou/dsh-suite) 目录，并通过本机 `dsh plugin --profile web add github:owner/repo` 安装。需要已安装 `pnpm`。这不是把 Oh-DSH 的隔离预览市场整包搬进来——那套依赖他们自己的桌面 Host。

## Chrome (grok-app-style)

- System tray
- Closing the window hides to tray; `dsh web` keeps running
- Tray **Show** restores the window
- Tray **Quit** stops the child `dsh web` process and exits
- If `dsh` is missing, the window shows an in-app error (not a blank crash)

## Requirements

- Windows 10/11 with WebView/Chromium (Electron)
- Independently installed CLI: `npm install -g @deepseek-ai/dsh`

This repo ships **only the desktop shell**. `dsh` is resolved from `PATH` / `DSH_BIN` on every launch, so `npm update -g @deepseek-ai/dsh` takes effect without rebuilding or reinstalling dsh app.

## Run

```bash
npm install
npm start
```

Unpackaged desktop entry: `npm start` (Electron).

Windows installer (shell only): `dist/dsh-app-setup.exe`  
Packaged portable exe: `dist/dsh-app.exe`  
Unpacked desktop exe: `dist/win-unpacked/dsh app.exe`

```bash
npm test
npm run pack
```

## Config

`dsh` itself still reads `~/.dsh` (`settings.yaml`, `.credentials.yaml`). Override the binary with `DSH_BIN`.
