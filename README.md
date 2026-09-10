# 小慈・兒童機器人物理模擬

在瀏覽器裡操控兒童機器人「小慈」：走路、轉彎、坐下、撿東西、踢球射門、前滾翻，還可以用聲音下指令。電腦和手機都能玩，不需要安裝任何東西。

## ▶ 開始玩

**https://11243039-stack.github.io/xiaoci/**

第一次打開需要下載約 30 MB，之後會快很多。

## 怎麼玩

| | 電腦 | 手機・平板 |
|---|---|---|
| 移動 | 方向鍵（按住＝一直走，輕按＝走一小步） | 左下角搖桿 |
| 動作 | 右邊的按鈕，或按 Y 坐下、G 撿東西、K／L 踢球、R 前滾翻 | 右下角的按鈕 |
| 視角 | 拖曳滑鼠旋轉，滾輪縮放 | 一指拖曳旋轉，兩指縮放 |
| 語音 | 點 🎤 或按 V，說「前進」、「左轉」、「坐下」、「踢球」、「你好」 | 點 🎤 後說話 |
| 跌倒了 | 按「重新開始」或 Backspace | 按「↺ 重新開始」 |

**踢球射門**：走到球旁邊，球在腳前面時畫面會提示，按「踢球」把球踢進球門！按「▶ 挑戰 60 秒」看看能進幾球。

小提醒：
- 請用 Chrome、Edge 或 Safari 開啟。用 LINE 等 App 內建的瀏覽器時，語音功能不能用。
- iPhone：用 Safari 的「分享 → 加入主畫面」，就能像 App 一樣全螢幕玩。

## 它是怎麼動的？

- 物理：MuJoCo（Google DeepMind）
- 動作：Pollen Robotics 開源機器人 MicroDuck 用強化學習訓練的動作模型，在瀏覽器裡執行
- 外觀：本專題自行設計（不含 Pollen Robotics 的 3D 模型）
- 所有計算都在你的裝置上進行，不收集個人資料

## 聲明與授權

本網站為學生專題作品，不是慈濟大學或 Pollen Robotics 的官方網站或產品。

使用的開源項目與授權：MicroDuck 動作模型與機器人數據（Pollen Robotics，Apache-2.0）、MuJoCo（Apache-2.0）、onnxruntime-web（MIT）、three.js（MIT）、qrcode-generator（MIT）。詳見網站內的「關於」頁面及 `vendor/`、`assets/policies/` 裡的 LICENSE 檔。
