# Cloudflare 操作說明（給使用者）

大部分 Cloudflare 的事 Claude Code 都會用指令完成。你只需要做下面幾件事：**登入一次**、**設定老師密碼**，以及之後偶爾到網頁後台看看。

> Cloudflare 後台的按鈕位置偶爾會改版，如果名稱和這裡寫的不完全一樣，找意思相近的就好。

---

## 第一部分：讓電腦登入 Cloudflare（只需做一次，Phase 0 開始前）

這一步讓 Claude Code 之後可以用你的帳號建立資料庫、部署網站。

1. 打開瀏覽器到 <https://dash.cloudflare.com>，確認你能登入（你之前用過 Workers，應該已經有帳號）。
2. 打開你平常跑 Claude Code 的終端機（WSL），切到任何資料夾都可以，輸入：
   ```
   npx wrangler login
   ```
   第一次會問要不要安裝 wrangler，輸入 `y` 按 Enter。
3. 終端機會印出一串網址，並嘗試打開瀏覽器。
   - 如果瀏覽器**有自動打開**：會看到一個授權頁面，列出 Wrangler 要求的權限，按最下面的 **Allow**。
   - 如果瀏覽器**沒有打開**（WSL 常見）：把終端機裡那串 `https://dash.cloudflare.com/oauth2/auth?...` 網址整段複製，貼到 Windows 的瀏覽器打開，一樣按 **Allow**。
4. 瀏覽器顯示授權成功後，回到終端機，應該會看到 `Successfully logged in.`
5. 確認：輸入
   ```
   npx wrangler whoami
   ```
   會顯示你的 email 和 Account ID，就完成了。

**如果第 3 步按了 Allow，終端機卻一直卡住沒反應**（WSL 偶爾收不到瀏覽器的回傳），按 `Ctrl + C` 取消，改用下面的「備案：API Token」。

### 備案：API Token

1. 在 Cloudflare 後台，右上角頭像 → **My Profile** → 左側 **API Tokens** → **Create Token**。
2. 找到範本 **Edit Cloudflare Workers**，按右邊的 **Use template**。
3. 在 Permissions 區塊檢查有沒有 **D1**。如果沒有，按 **+ Add more**，選 `Account` → `D1` → `Edit`。
4. **Account Resources** 選你的帳號；**Zone Resources** 選 `All zones`。
5. 拉到最下面 **Continue to summary** → **Create Token**。
6. 畫面會顯示一串 token（**只會顯示這一次**），複製起來。
7. 回到 WSL 終端機，輸入（把 `貼上token` 換成剛剛那串）：
   ```
   echo 'export CLOUDFLARE_API_TOKEN=貼上token' >> ~/.bashrc
   source ~/.bashrc
   npx wrangler whoami
   ```
   看到 email 就成功了。不要把 token 貼到對話或 repo 裡。

---

## 第二部分：設定老師密碼（Phase 0 部署完成後）

Claude Code 在 Phase 0 完成時會告訴你「可以設定密碼了」。

1. 在終端機切到專案資料夾（例如 `cd ~/jushou`）。
2. 輸入：
   ```
   npx wrangler secret put TEACHER_PASSWORD
   ```
3. 出現 `Enter a secret value:` 後，輸入你想給媽媽用的密碼（**打字時畫面不會顯示**，這是正常的），按 Enter。
4. 看到 `Success! Uploaded secret TEACHER_PASSWORD` 就完成了。

之後想改密碼，重做一次同樣的指令即可。改完後已登入的裝置不會被登出（如果需要全部登出，跟 Claude Code 說「換掉 SESSION_SECRET」）。

建議密碼：好記但別人猜不到，例如一句話的注音或拼音加數字。這只擋外人，不用像銀行密碼那麼複雜。

---

## 第三部分：在後台找東西

### 網站網址
Cloudflare 後台左側 **Compute (Workers)**（或 **Workers & Pages**）→ 點 **jushou** → 會看到網址，長得像 `https://jushou.你的名稱.workers.dev`。
- 學生用：這個網址本身
- 老師用：網址後面加 `/t/`

### 資料庫
左側 **Storage & Databases** → **D1 SQL Database** → **jushou-db**。可以看到資料表內容。**只看就好，不要在這裡手動修改或刪除資料**，有需要請 Claude Code 寫 migration。

### 用量
左側 **Compute (Workers)** → **jushou** → **Metrics**。可以看到每天請求數。

---

## 第四部分：清理舊專案（可選，確定不需要舊版後再做）

舊 repo 在 Cloudflare 上留了一個 Worker 和一個資料庫：

1. **Compute (Workers)**（或 **Workers & Pages**）→ 點 **classroom-relay** → 上方 **Settings** → 拉到最下面 **Delete** → 依指示輸入名稱確認。
2. **Storage & Databases** → **D1 SQL Database** → **classroom-installations** → **Settings** → **Delete**。
3. 如果 Workers 列表裡還有其他舊版留下的項目（例如舊的 Pages 專案），確認不是別的用途後一樣可以刪除。

---

## 免費方案夠不夠用？

完全夠。1 位老師 + 30 位學生的用量，離免費額度很遠：
- Workers 免費方案：每天 10 萬次請求
- Durable Objects（上課即時連線用）：免費方案可用，每天 10 萬次請求；用 Hibernation 方式連線時，學生掛著不動不會消耗執行時間
- D1：免費方案的讀寫與容量對這個規模都綽綽有餘

超過額度不會被扣錢，只會當天出錯，隔天（台灣時間早上 8 點）重置。不需要綁信用卡。

---

## 要先測試的事：學校網路

有些學校的網路會擋 `workers.dev` 網域。**Phase 0 部署好之後，請找機會在學校的 Wi-Fi 和學校電腦上打開網址看看。** 如果打不開，之後可以買一個便宜的網域（一年幾百元）綁上去，到時候再請 Claude Code 寫步驟。
