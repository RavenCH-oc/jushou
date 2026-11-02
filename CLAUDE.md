# 舉手（jushou）— Claude Code 工作規範

給一位高中國文老師上課用的互動工具：老師推題、學生用手機作答、分組、互評、統計。
使用規模固定是 **1 位老師 + 約 30 位學生**，不會變成多校、多老師的產品。

產品需求見 `docs/PRODUCT.md`，目前進度見 `status.md`。每個任務的指令會放在 `docs/tasks/`。

## 最重要的原則

1. **簡單優先。** 能用 30 行解決就不要寫 300 行。不要為了「未來可能」加抽象層、設定項、外掛機制。
2. **使用者是對電腦不熟的老師。** 介面判斷標準是「她第一次看到能不能不問人就會用」。
3. **學校電腦效能差、學生用舊手機。** 每個功能都要考慮效能（見下方效能預算）。
4. 不要做企業級流程：不要寫 ADR、evidence、hash 清單、risk acceptance、gate、Pass A/B 之類的文件或腳本。

## 技術選擇（已決定，不要更換）

- 部署：Cloudflare Workers（含 static assets）+ D1（資料庫）+ Durable Objects（上課即時連線，Phase 3 才加）+ R2（圖片，之後才加）
- 後端：TypeScript + Hono
- 前端：Preact + TypeScript + Vite，搭配 `@cloudflare/vite-plugin`
- 樣式：手寫 CSS（CSS 變數），**不使用** UI 框架、Tailwind、icon 字型、Web 字型
- 測試：Vitest。重點測評分邏輯、權限檢查、資料驗證；不追求覆蓋率數字
- 套件管理：pnpm。**單一 package**，不要 monorepo
- 新增任何 npm 依賴前，先想能不能不加；加了要在 PR 說明為什麼

目錄結構：

```
src/worker/    Hono API、D1 存取、Durable Object
src/teacher/   老師端頁面（/t/）
src/student/   學生端頁面（/）
src/shared/    前後端共用的型別、題型定義、評分函式
migrations/    D1 SQL migrations（0001_xxx.sql 依序編號）
```

## 效能預算

- 學生端 JS（gzip 後）< 80 KB，老師端 < 150 KB
- 使用系統字型：`font-family: system-ui, "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`。**絕對不要載入中文 Web 字型**（動輒數 MB）
- 不用動畫函式庫；CSS transition 也盡量少
- 要能在近 3 年的 Chrome／Edge／Safari 跑；不要用太新的 API
- 即時更新用 WebSocket 推送，不要每秒 polling；Durable Object 使用 WebSocket Hibernation API（免費方案的執行時間額度才夠用）
- 每個 PR 在說明裡附上 `pnpm build` 後的檔案大小

## 介面原則

- 每個畫面只有**一個主要動作**，用大按鈕、深色底，其他動作用次要樣式
- 按鈕用**文字**寫清楚做什麼（「開始上課」「下一題」），不要只放圖示
- 刪除、結束上課等不可逆動作要確認，並寫出後果（「刪除後學生的作答紀錄也會消失」）
- 不要巢狀選單、不要拖曳當唯一操作方式、不要 hover 才出現的按鈕（觸控螢幕沒有 hover）
- 老師上課時的畫面會投影：字要大（內文至少 20px，題目 32px 以上）、高對比
- 學生端以手機直式為主：按鈕至少 48px 高、選項整列可點
- 錯誤訊息用白話：說發生什麼事、要怎麼辦。不要顯示錯誤碼或英文 stack
- 所有使用者看得到的文字用**繁體中文（台灣用語）**

## 語言

- 程式碼、檔名、變數、commit message：英文
- UI 文字：繁體中文
- 回報給使用者的說明、PR 描述、status.md：**白話繁體中文**，短。技術名詞可以用英文，但不要堆砌術語。假設讀者懂程式但不想讀公文

## Git 流程

1. 每個任務開新 branch：`claude/<簡短英文描述>`
2. 小步 commit，訊息清楚
3. 完成後 push，並用 `gh pr create` 開 PR（如果 `gh` 不能用就只 push，並告訴使用者）
4. **不要自己 merge**，使用者審核後會 squash merge
5. PR 描述包含：做了什麼、怎麼測的、使用者需要手動做的事（如果有）、已知問題

## 部署

- 本機開發用 `pnpm dev`（本地 D1，不碰正式資料）
- 正式部署：`pnpm run deploy`（build → 套用遠端 D1 migrations → `wrangler deploy`）
- **只在 main 上、且使用者明確說要部署時才部署正式環境**（Phase 0 驗證部署流程是例外，任務指令會寫）
- 需要使用者在 Cloudflare 或終端機操作的步驟，要**一步一步寫清楚**：在哪裡、點什麼、輸入什麼、成功會看到什麼。使用者幾乎沒用過 Cloudflare
- 密碼與金鑰放 Wrangler secrets，本機用 `.dev.vars`（已 gitignore）。不要把任何密碼、token、學生名單寫進 repo

## 資料安全（夠用就好）

- 老師端 API 全部要驗證老師登入
- 學生只能看到自己的答案和老師公開的內容；題目的正確答案在老師揭曉前不能送到學生端
- 學生不能冒用別人身分作答（座號綁定裝置，見 PRODUCT.md）
- 不需要做稽核紀錄、限流系統、多租戶隔離

## status.md

每個任務結束時更新，保持 40 行以內：目前完成到哪、下一步、已知問題、使用者待辦。只寫現況，不寫歷史。
