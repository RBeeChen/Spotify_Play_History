import os
import json
import subprocess
import sys
import requests # 引入 requests 模組

def run_command(command, cwd=None):
    """
    執行命令並捕獲其輸出。
    """
    try:
        # 使用 subprocess.run 而非 call 或 check_call，以便完整捕獲輸出
        result = subprocess.run(
            command,
            cwd=cwd,
            shell=True,
            check=True, # 如果返回非零狀態碼則拋出 CalledProcessError
            capture_output=True, # 捕獲 stdout 和 stderr
            text=True, # 以文本模式捕獲輸出 (Python 3.7+)
            encoding='utf-8', # 確保使用 UTF-8 編碼
            errors='ignore' # 忽略編碼錯誤
        )
        print(f"命令執行成功: {' '.join(command) if isinstance(command, list) else command}")
        print("--- 標準輸出 ---")
        print(result.stdout)
        if result.stderr:
            print("--- 標準錯誤 (若有) ---")
            print(result.stderr)
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"命令執行失敗: {' '.join(command) if isinstance(command, list) else command}")
        print("--- 錯誤代碼 ---")
        print(e.returncode)
        print("--- 標準輸出 (可能包含錯誤) ---")
        print(e.stdout)
        print("--- 標準錯誤 ---")
        print(e.stderr)
        return None
    except FileNotFoundError:
        print(f"錯誤: 命令 '{command[0] if isinstance(command, list) else command.split()[0]}' 未找到。請確認您已安裝 Node.js 和 npm，並且它們在您的 PATH 中。")
        return None
    except Exception as e:
        print(f"執行命令時發生意外錯誤: {e}")
        return None

def check_deployed_webpage(url):
    """
    檢查已部署網頁的基本狀態。
    """
    print(f"\n--- 正在檢查已部署網頁: {url} ---")
    try:
        response = requests.get(url, timeout=15) # 設置超時時間為 15 秒
        print(f"✅ 網頁 HTTP 狀態碼: {response.status_code}")

        if response.status_code != 200:
            print(f"🚨 警告: 網頁載入失敗，狀態碼為 {response.status_code}。")
            print("這可能表示網頁不存在或伺服器問題。")
            return False

        html_content = response.text

        # 檢查 React 應用的根元素
        if '<div id="root"></div>' in html_content or '<div id="root">' in html_content:
            print("✅ 在 HTML 內容中找到 React 應用程式的根元素 (<div id=\"root\">)。")
        else:
            print("🚨 警告: 未在 HTML 內容中找到 React 應用程式的根元素 (<div id=\"root\">)。")
            print("這可能表示 React 應用程式未能正確渲染或 HTML 模板已修改。")

        # 檢查 CSS 和 JS 資源連結
        # 從 package.json 的 homepage URL 提取 repo_name
        repo_name = ""
        package_json_path = os.path.join(os.getcwd(), 'package.json')
        try:
            with open(package_json_path, 'r', encoding='utf-8') as f:
                package_json = json.load(f)
            homepage_url = package_json.get('homepage', '')
            if homepage_url:
                # 簡單提取 repo_name，例如從 "https://RBeeChen.github.io/Spotify_Play_History" 提取 Spotify_Play_History
                repo_name = homepage_url.split('/')[-1] if homepage_url.split('/')[-1] else homepage_url.split('/')[-2]
        except Exception as e:
            print(f"讀取 package.json 以獲取 repo_name 失敗: {e}")
            repo_name = "your_repo_name_fallback" # 使用一個預設值

        expected_css_path_pattern = f'/{repo_name}/static/css/main.'
        expected_js_path_pattern = f'/{repo_name}/static/js/main.'

        css_found = expected_css_path_pattern in html_content
        js_found = expected_js_path_pattern in html_content

        if css_found:
            print(f"✅ 在 HTML 內容中找到 CSS 資源連結 (例如: {expected_css_path_pattern}...)。")
        else:
            print(f"🚨 警告: 未在 HTML 內容中找到 CSS 資源連結 (例如: {expected_css_path_pattern}...)。")
            print("這可能表示 Tailwind CSS 或其他樣式檔案未能正確打包或引用。")

        if js_found:
            print(f"✅ 在 HTML 內容中找到 JavaScript 資源連結 (例如: {expected_js_path_pattern}...)。")
        else:
            print(f"🚨 警告: 未在 HTML 內容中找到 JavaScript 資源連結 (例如: {expected_js_path_pattern}...)。")
            print("這可能表示主要的 JavaScript 應用程式檔案未能正確打包或引用。")
        
        # 額外檢查：如果 HTML 內容中包含 "React App" 標題但沒有正確的 React 元素或 CSS/JS 連結，可能說明建置不完整
        if "React App" in html_content and not (('<div id="root">' in html_content) and css_found and js_found):
            print("🚨 警告: 網頁標題是 'React App'，但缺少關鍵的 React 根元素或資源連結。")
            print("這通常表示 React 應用程式的建置不完整或部署錯誤。")


        if response.status_code == 200 and ('<div id="root">' in html_content) and css_found and js_found:
             print("✨ 網頁初步檢查結果: 成功載入，並找到主要 React 元素和資源連結。")
             return True
        else:
            print("🚨 網頁初步檢查結果: 存在潛在問題，請檢查上述警告。")
            return False

    except requests.exceptions.RequestException as e:
        print(f"❌ 錯誤: 無法訪問網頁 '{url}'。錯誤: {e}")
        print("請檢查您的網路連線，或確認 GitHub Pages URL 是否正確且已公開。")
        return False
    except Exception as e:
        print(f"❌ 檢查網頁時發生未知錯誤: {e}")
        return False

def check_react_app_status():
    """
    檢查 React 專案的狀態並提供偵錯建議。
    """
    project_root = os.getcwd()
    print(f"正在檢查專案根目錄: {project_root}\n")

    # 0. 檢查 Node.js 和 npm 版本
    print("--- 檢查 Node.js 和 npm 版本 ---")
    node_version = run_command("node -v")
    npm_version = run_command("npm -v")

    if node_version:
        print(f"✅ Node.js 版本: {node_version.strip()}")
    else:
        print("🚨 警告: 無法獲取 Node.js 版本。請確認 Node.js 已安裝並在 PATH 中。")
    
    if npm_version:
        print(f"✅ npm 版本: {npm_version.strip()}")
    else:
        print("🚨 警告: 無法獲取 npm 版本。請確認 npm 已安裝並在 PATH 中。")


    # 1. 檢查 node_modules 資料夾
    node_modules_path = os.path.join(project_root, 'node_modules')
    if not os.path.exists(node_modules_path):
        print("\n🚨 偵測到問題: 'node_modules' 資料夾不存在。")
        print("這表示您的專案依賴尚未安裝。")
        print("請執行: `npm install`")
        return False
    else:
        print("\n✅ 'node_modules' 資料夾存在。")

    # 2. 檢查 package.json 中的 react-scripts 版本
    package_json_path = os.path.join(project_root, 'package.json')
    if not os.path.exists(package_json_path):
        print("❌ 錯誤: 'package.json' 檔案不存在於專案根目錄。")
        print("請確認您在正確的專案資料夾中執行此腳本。")
        return False

    package_json = {}
    try:
        with open(package_json_path, 'r', encoding='utf-8') as f:
            package_json = json.load(f)

        react_scripts_version = package_json.get('dependencies', {}).get('react-scripts')
        
        if react_scripts_version:
            print(f"\n✅ 在 package.json 中找到 'react-scripts' 版本: {react_scripts_version}")
            if react_scripts_version == '^0.0.0':
                print("🚨 偵測到問題: 'react-scripts' 版本被設定為 '^0.0.0'。")
                print("這是一個無效的版本，通常是由於 `npm audit fix --force` 引起的。")
                print("--- 建議的修正步驟 (非常重要！) ---")
                print("1. **手動編輯** `package.json` 檔案。")
                print(f"   將 `\"react-scripts\": \"{react_scripts_version}\"` 這一行改為 `\"react-scripts\": \"^5.0.1\"` (推薦穩定版本)。")
                print("   **務必保存 `package.json` 檔案。**")
                print("2. 刪除 'node_modules' 資料夾和 'package-lock.json' 檔案。")
                print("   執行: `rmdir /s /q node_modules`")
                print("   執行: `del package-lock.json`")
                print("3. 重新安裝所有依賴。")
                print("   執行: `npm install`")
                print("   **重要提示: 完成後，請不要執行 `npm audit fix --force`。**")
                print("4. 再次嘗試部署。")
                print("   執行: `npm run deploy`")
                return False
            else:
                print("版本看起來正常。")
        else:
            print("🚨 偵測到問題: 'react-scripts' 未在 'dependencies' 中找到或版本無效。")
            print("請確認您的 'package.json' 設定正確，並且 'react-scripts' 已在 'dependencies' 中。")
            return False

    except json.JSONDecodeError:
        print("❌ 錯誤: 'package.json' 檔案的 JSON 格式不正確。")
        print("請檢查 'package.json' 的語法錯誤。")
        return False
    except Exception as e:
        print(f"❌ 讀取 'package.json' 時發生未知錯誤: {e}")
        return False

    # 3. 檢查 Tailwind CSS 配置文件
    print("\n--- 檢查 Tailwind CSS 配置檔案 ---")
    tailwind_config_path = os.path.join(project_root, 'tailwind.config.js')
    postcss_config_path = os.path.join(project_root, 'postcss.config.js')
    index_css_path = os.path.join(project_root, 'src', 'index.css')

    if os.path.exists(tailwind_config_path):
        print(f"✅ 找到 'tailwind.config.js'。")
    else:
        print(f"🚨 警告: 未找到 'tailwind.config.js'。如果您的應用程式使用 Tailwind CSS，這是一個問題。")
        print("請確認它存在於專案根目錄。")

    if os.path.exists(postcss_config_path):
        print(f"✅ 找到 'postcss.config.js'。")
    else:
        print(f"🚨 警告: 未找到 'postcss.config.js'。如果您的應用程式使用 Tailwind CSS，這是一個問題。")
        print("請確認它存在於專案根目錄。")

    if os.path.exists(index_css_path):
        print(f"✅ 找到 'src/index.css'。")
        with open(index_css_path, 'r', encoding='utf-8', errors='ignore') as f:
            index_css_content = f.read()
            if "@tailwind base;" in index_css_content and \
               "@tailwind components;" in index_css_content and \
               "@tailwind utilities;" in index_css_content:
                print("✅ 'src/index.css' 包含 Tailwind CSS 的核心指令。")
            else:
                print("🚨 警告: 'src/index.css' 未包含 Tailwind CSS 的核心指令。")
                print("請確保在 'src/index.css' 檔案的頂部添加以下三行:")
                print("  @tailwind base;")
                print("  @tailwind components;")
                print("  @tailwind utilities;")
    else:
        print(f"❌ 錯誤: 未找到 'src/index.css'。這是 React 應用程式的關鍵樣式檔案。")

    # 4. 嘗試運行 npm build
    print("\n--- 嘗試運行 `npm run build` ---")
    print("請注意上方輸出，如果建置失敗，請複製並分享錯誤訊息。")
    build_output = run_command(['npm', 'run', 'build'], cwd=project_root)
    if build_output is None:
        print("🚨 'npm run build' 失敗。這是一個嚴重的問題。")
        print("您必須解決建置失敗的問題才能成功部署。")
        print("請仔細檢查上方 `npm run build` 的輸出，尋找錯誤訊息，並嘗試 Google 這些錯誤。")
        return False
    else:
        print("✅ 'npm run build' 成功完成。")
        # 檢查 build 資料夾
        build_dir_path = os.path.join(project_root, 'build')
        if os.path.exists(build_dir_path) and os.listdir(build_dir_path):
            print(f"✅ 'build' 資料夾已成功生成。")
        else:
            print(f"🚨 警告: 'build' 資料夾似乎為空或未正確生成。")
            print("即使 'npm run build' 顯示成功，請檢查 'build' 資料夾的內容。")


    # 5. 嘗試運行 npm deploy
    print("\n--- 嘗試運行 `npm run deploy` ---")
    print("請注意上方輸出，如果部署失敗，請複製並分享錯誤訊息。")
    deploy_output = run_command(['npm', 'run', 'deploy'], cwd=project_root)
    
    if deploy_output is not None:
        print("✅ 'npm run deploy' 成功完成。")
        print("\n--- 部署完成 ---")
        print("部署已嘗試完成。現在將檢查已部署的網頁。")
        
        deployed_url = package_json.get('homepage', "https://RBeeChen.github.io/Spotify_Play_History")
        print(f"偵測到的部署 URL: {deployed_url}")
        
        check_web_status = check_deployed_webpage(deployed_url)
        if check_web_status:
            print("\n恭喜！您的網頁似乎已成功部署且初步正常。")
        else:
            print("\n已部署的網頁初步檢查發現問題。請參考上方訊息進行偵錯。")

        print("\n請務必執行以下操作:")
        print("1. **強制清除瀏覽器快取** (例如 Ctrl + Shift + R 或 Cmd + Shift + R)。")
        print(f"2. 再次訪問您的 GitHub Pages 網頁: {deployed_url}")
        print("如果介面仍然不正常，請檢查瀏覽器的開發者工具 (F12) 中的 Console 和 Network 選項卡，尋找任何錯誤。")
        return True # Return True if deploy was successful, even if web check has warnings
    else:
        print("🚨 'npm run deploy' 失敗。請檢查上方錯誤訊息以獲取詳細資訊。")
        return False
    
if __name__ == "__main__":
    print("--- 正在啟動 React 專案部署偵錯工具 ---")
    check_react_app_status()
    print("\n--- 偵錯工具運行結束 ---")
