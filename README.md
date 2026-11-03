# 舉手（jushou）

國文課用的互動工具：老師推題、學生用手機作答。1 位老師 + 約 30 位學生。

- 學生端：`/`
- 老師端：`/t/`（密碼登入）
- 正式網址：https://jushou.ryanaddy1102.workers.dev

產品需求見 [docs/PRODUCT.md](docs/PRODUCT.md)，Cloudflare 操作見 [docs/cloudflare-setup.md](docs/cloudflare-setup.md)。

## 本機開發

在 PowerShell 的 `D:\ClaudeCode\jushou` 資料夾執行：

```powershell
pnpm install
pnpm dev
```

打開 http://localhost:5173/t/ ，密碼 `dev`。本機資料庫在 `.wrangler/`，不會碰到正式資料；`pnpm dev` 會先自動套用新的 migration（有新的時會問一次，輸入 `y`）。

第一次在新電腦上開發，要先建立 `.dev.vars`（已被 git 忽略）：

```powershell
node -e "process.stdout.write('TEACHER_PASSWORD=dev\nSESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex') + '\n')" > .dev.vars
```

其他指令：`pnpm test`、`pnpm typecheck`、`pnpm build`。

測試用 Node 內建的 `node:sqlite` 模擬 D1（`src/worker/test/d1.ts`），需要 Node 22.5 以上。

## 部署

只在 `main` 上部署：

```powershell
pnpm run deploy
```

會依序 build、套用遠端資料庫 migration、上傳 Worker。
