# 我的心得筆記

記錄 📺 YouTube 心得、📚 讀書心得、💡 靈光一現的小 App。
打開就是輸入頁，可以加到手機主畫面，像一般 App 一樣使用。

App 網址（開啟 GitHub Pages 之後）：<https://alicenoted-coder.github.io/about-me/>

## 資料夾說明

| 資料夾 | 放什麼 |
|---|---|
| `docs/` | App 程式（GitHub Pages 從這裡發布） |
| `notes/youtube/` | YouTube 心得 |
| `notes/books/` | 讀書心得 |
| `notes/ideas/` | 靈光一現 |

每篇筆記都是一個 `.md` 檔，在 App 按「儲存」就會自動存進 `notes/`。
也可以直接在 GitHub 上新增或修改 `notes/` 裡的檔案，App 會同步顯示。

## 第一次設定

### 1. 開啟 GitHub Pages（只要做一次）

1. 到 repo 的 **Settings → Pages**
2. Source 選 **Deploy from a branch**
3. Branch 選 **main**，資料夾選 **/docs**，按 Save
4. 等 1～2 分鐘，上面的 App 網址就能打開

### 2. 建立 GitHub 金鑰（每個金鑰可以用在多台裝置）

1. 打開 <https://github.com/settings/personal-access-tokens/new>
2. Token name 隨便取，例如「心得筆記」；Expiration 選你要的期限
3. Repository access 選 **Only select repositories**，只勾 `about-me`
4. Permissions → Repository permissions → **Contents** 改成 **Read and write**
5. 按 Generate token，複製 `github_pat_` 開頭的那串

### 3. 在手機或電腦上打開 App

1. 打開 App 網址，點右上角 ⚙️，貼上金鑰，按「儲存並測試連線」
2. 加到主畫面：
   - **iPhone**：用 Safari 打開 → 分享按鈕 → 加入主畫面
   - **Android**：用 Chrome 打開 → 右上角選單 → 安裝應用程式／加到主畫面

金鑰只會存在那台裝置的瀏覽器裡，不會上傳到任何地方。不要把金鑰給別人。

## 注意

- 這個 repo 是**公開的**，`notes/` 裡的筆記任何人都能在 GitHub 上看到。
- 還沒連接 GitHub 時也可以先寫，內容會暫存在那台裝置，設定好之後再按儲存。
- 同一篇筆記在兩台裝置上都改過時，App 會提醒你，不會直接蓋掉。

## 筆記檔案格式

```markdown
---
type: book
title: 原子習慣
date: 2026-10-28 14:30
tags:
  - 習慣
  - 心理學
author: James Clear
status: 讀完
rating: 5
quotes:
  - 每天進步 1%。（p.12）
---

心得內文……
```

| type | 欄位 |
|---|---|
| `youtube` | `url`、`title`、`channel`、`watched`（觀看日期）、`rating`、`timestamps`（一行一則：`12:30 內容`） |
| `book` | `title`、`author`、`status`（想讀／在讀／讀完）、`cover`（書封網址）、`rating`、`quotes`、`started`、`finished` |
| `idea` | `title`（可省略）、`source`（靈感來源筆記的路徑，例如 `notes/books/xxx.md`） |

所有類型都有 `date`（建立時間）和 `tags`（標籤）。
