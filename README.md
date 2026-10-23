# EIGACAM · 一拍入戲

手機優先的照片調色網站，提供十款電影情緒色彩、獨立高光與陰影層、RGB 曲線與可調底片顆粒。

## 使用

開啟 https://bbcode1111.github.io/eigacam/ ，選擇照片或拍一張，再選風格、調整 MIX 與顆粒，最後匯出 JPEG。可以從手機瀏覽器「加入主畫面」。

照片在裝置內處理，不會上傳至伺服器。離線快取僅包含應用程式與示範圖片。重新整理前請先匯出照片。

## 功能

- JPEG、PNG、WebP 匯入與手機拍照後調色。
- 十款風格、0–100% MIX、高光與陰影分層。
- 明度與 RGB 五點曲線、曝光、對比、冷暖及飽和。
- 底片顆粒強度、尺寸與粗糙度，提供細緻、經典與粗獷快速設定。
- 原圖比較、復原／重做、配方儲存與匯入。
- 按原圖重新運算匯出，桌面最高 36MP、手機最高 12MP，不放大原圖。
- 可加入主畫面的 PWA。

## 開發與部署

無須建置或外部套件。網站檔案位於 `dist/`。

```sh
python3 -m http.server 8766
# 開啟 http://localhost:8766/dist/
node --test tests/core.test.mjs
```

瀏覽器測試：`/tests/gpu.html`、`/tests/grain.html`、`/tests/mobile.html`。

推送至 `main` 後，GitHub Actions 先執行核心測試，再將 `dist/` 部署至 GitHub Pages。

## 相容性

需要 WebGL2 與 EXT_color_buffer_float。支援照片調色，尚未支援即時調色相機、影片、RAW、HEIC 或 HDR。若手機相機提供 HEIC，請先轉成 JPEG。不同裝置與瀏覽器的色彩呈現可能稍有差異。

示範照片來自 Unsplash，個別來源列於網站的「關於」。色彩配方為創作詮釋，非官方 LUT。
