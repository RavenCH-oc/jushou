# Phase 0：專案骨架、部署流程、老師登入

先讀 `CLAUDE.md` 和 `docs/PRODUCT.md`。

## 目標

建立能在本機跑、也能部署到 Cloudflare 的最小專案，並完成老師登入。做完後，使用者可以打開正式網址、用密碼登入老師端，看到一個空的首頁。

## 要做的事

1. **專案骨架**
   - 依 `CLAUDE.md` 的技術選擇和目錄結構建立專案（pnpm、Vite + `@cloudflare/vite-plugin`、Preact、Hono）
   - `wrangler.jsonc`：Worker 名稱 `jushou`，D1 binding 名稱 `DB`、資料庫名稱 `jushou-db`
   - Scripts：`dev`、`build`、`typecheck`、`test`、`lint`（可選）、`deploy`（build → `wrangler d1 migrations apply jushou-db --remote` → `wrangler deploy`）
   - `.gitignore` 包含 `.dev.vars`、`.wrangler/`、`node_modules/`、`dist/`
   - `.gitattributes`：`* text=auto eol=lf`
   - 開始前先確認 `node`、`pnpm`、`git`、`gh` 都能用（`gh auth status`）。缺少的話停下來，請使用者照 `docs/cloudflare-setup.md` 第零部分安裝

2. **路由**
   - `/` 學生端：先放一個「輸入加入碼」的畫面（還不用接後端，顯示「功能製作中」即可）
   - `/t/` 老師端：未登入時顯示登入頁，登入後顯示首頁（標題 + 「班級」區塊，目前是空的，寫「還沒有班級」）
   - `/api/...` 後端 API

3. **老師登入**
   - 只有一位老師，只需要密碼，不需要帳號
   - 密碼存在 Wrangler secret `TEACHER_PASSWORD`；簽 cookie 用的金鑰存在 `SESSION_SECRET`
   - 登入成功後發 HttpOnly、Secure、SameSite=Lax 的簽章 cookie，有效 30 天（老師不用每堂課都登入）
   - 老師端 API 加一個 middleware 檢查 cookie；未登入回 401，前端導回登入頁
   - 密碼比對用固定時間比較
   - 連續輸錯不用做鎖定（1 位老師的工具不需要）
   - 有「登出」按鈕
   - 本機開發：建立 `.dev.vars`，`TEACHER_PASSWORD=dev`，`SESSION_SECRET` 填一個隨機字串

4. **D1 第一個 migration**
   - `migrations/0001_init.sql`：先建一張 `app_meta`（key/value）表就好，確認 migration 流程能跑。正式資料表在 Phase 1 再建

5. **基本樣式**
   - `src/shared/` 或各端放一份共用的 CSS 變數（顏色、字級、間距、按鈕樣式）
   - 依 `CLAUDE.md` 的介面原則：系統字型、大按鈕、高對比

6. **文件**
   - `README.md`（繁中，短）：這是什麼、本機怎麼跑、怎麼部署
   - `status.md`

## 部署驗證（本階段特例：允許從 branch 部署一次）

使用者會先依 `docs/cloudflare-setup.md` 第一部分完成 `wrangler login`。開始部署前，先跑 `npx wrangler whoami` 確認已登入；若未登入，停下來請使用者照文件操作。

1. `npx wrangler d1 create jushou-db`，把回傳的 `database_id` 填進 `wrangler.jsonc`
2. 用 `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put SESSION_SECRET` 設定簽章金鑰（不要把值印出來）
3. `TEACHER_PASSWORD` **請使用者自己設定**（見 `docs/cloudflare-setup.md` 第二部分），不要替使用者決定密碼
4. `pnpm run deploy`
5. 用 curl 確認首頁回 200、未登入呼叫老師 API 回 401
6. 在 PR 描述寫上正式網址

如果第一次部署時 Worker 還沒有 `TEACHER_PASSWORD`，登入要回傳清楚的錯誤（「尚未設定老師密碼」），不能讓任何密碼都能登入。

## 驗收

- `pnpm typecheck`、`pnpm test`、`pnpm build` 都通過
- 測試至少涵蓋：密碼正確／錯誤、cookie 竄改會被拒絕、未登入呼叫老師 API 回 401、未設定密碼時無法登入
- PR 描述附上 build 後的 JS 大小（gzip）
- 正式網址可開，使用者設定密碼後能登入

## 不要做

- 班級、學生、題目等任何正式功能
- CI、Docker、monorepo、i18n 框架、狀態管理函式庫、router 函式庫（兩端都只有少數畫面，自己判斷路徑即可）
