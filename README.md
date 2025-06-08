Spotify 播放記錄分析器
這是一個使用 React 構建的網頁應用程式，用於分析和可視化您的 Spotify 播放歷史數據。

功能特色
JSON 檔案上傳: 支援多個 Spotify 播放歷史 JSON 檔案的載入與合併。

日期範圍篩選: 依據指定日期範圍篩選播放記錄。

多樣化排行: 支援按歌曲、歌手、專輯、平台、國家、播放開始/結束原因、隨機播放、跳過、離線、隱身模式、總播放時長等多種維度進行排行。

排行標準選擇: 可選擇按播放次數、總播放時長或平均播放時長進行排行。

趨勢分析: 提供每月總收聽時長、每月熱門歌曲和每月熱門歌手的趨勢分析。

結果搜尋與篩選: 在主要分析結果中進行即時搜尋。

詳細記錄查看: 雙擊排行榜項目可查看該歌曲/專輯/URI 的所有詳細播放記錄。

藝術家階層式視窗: 雙擊歌手可查看該歌手的專輯及歌曲播放統計。

網頁快速搜尋: 在詳細記錄視窗中提供 Google 搜尋歌詞、專輯評價、藝術家簡介等功能。

CSV 匯出: 將分析結果或詳細記錄匯出為 CSV 檔案。

本地開發設置
1. 安裝必要工具
請確保您的電腦已安裝 Node.js (內含 npm) 或 Yarn。

2. 下載專案
git clone https://github.com/RBeeChen/Spotify_Play_History.git
cd Spotify_Play_History

3. 安裝依賴項
在專案目錄中，運行：

npm install
# 或使用 yarn
# yarn install

4. 將 React 程式碼貼到專案中
請確保您已將本 AI 之前提供的 React 應用程式程式碼（App.js 及相關樣式和元件）正確地放入 src/ 目錄中。

5. 可用腳本
在專案目錄中，您可以運行：

npm start
在開發模式下運行應用程式。

在瀏覽器中打開 http://localhost:3000 即可查看。

當您進行更改時，頁面將會重新載入。

您也可能會在控制台中看到任何 Lint 錯誤。

npm test
以互動式監控模式啟動測試運行器。

有關更多信息，請參閱 運行測試 部分。

npm run build
將應用程式構建為生產環境版本到 build 文件夾。

它正確地將 React 捆綁到生產模式中，並優化構建以獲得最佳性能。

構建後的檔案經過壓縮，文件名包含哈希值。

您的應用程式已準備好部署！

有關更多信息，請參閱 部署 部分。

npm run eject
注意：這是一次性操作。一旦您 eject，就無法撤銷！

如果您對構建工具和配置選擇不滿意，可以隨時 eject。此命令將從您的項目中刪除單一構建依賴項。

相反，它將所有配置文件和傳遞依賴項（webpack、Babel、ESLint 等）直接複製到您的項目中，以便您完全控制它們。除了 eject 之外的所有命令仍然有效，但它們將指向複製的腳本，以便您可以調整它們。此時您將自行負責。

您不必使用 eject。策劃的功能集適用於小型和中型部署，您不應該覺得有義務使用此功能。但是，我們理解如果您在準備好時無法自定義此工具，那麼它將沒有用。

了解更多
您可以在 Create React App 文檔 中了解更多信息。

要學習 React，請查閱 React 文檔。

代碼拆分 (Code Splitting)
此部分已移至此處：https://facebook.github.io/create-react-app/docs/code-splitting

分析捆綁包大小 (Analyzing the Bundle Size)
此部分已移至此處：https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size

製作漸進式網頁應用程式 (Making a Progressive Web App)
此部分已移至此處：https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app

高級配置 (Advanced Configuration)
此部分已移至此處：https://facebook.github.io/create-react-app/docs/advanced-configuration

部署 (Deployment)
此部分已移至此處：https://facebook.github.io/create-react-app/docs/deployment

npm run build 無法壓縮 (fails to minify)
此部分已移至此處：https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify