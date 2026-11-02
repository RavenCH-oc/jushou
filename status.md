# 目前狀態

## 完成
- Phase 0：專案骨架、老師密碼登入、部署流程
- 正式網址：https://jushou.ryanaddy1102.workers.dev（老師端 `/t/`）
- D1 `jushou-db` 已建立，`0001_init` 已套用；`SESSION_SECRET` 已設定

## 下一步
- Phase 1：班級、學生名冊、分組（`docs/tasks/phase-1.md`）

## 使用者待辦
- 設定老師密碼：照 `docs/cloudflare-setup.md` 第二部分執行 `npx wrangler secret put TEACHER_PASSWORD`
- 在學校 Wi-Fi／學校電腦打開正式網址，確認沒被擋

## 已知問題
- 學生端輸入加入碼後只顯示「功能製作中」（Phase 3 才接上）
