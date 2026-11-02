@echo off
chcp 936 >nul
title 数码考古馆 · 启动器
cd /d "%~dp0"
set PORT=8787
set "URL=http://127.0.0.1:%PORT%/"

rem ---------- 找 Python ----------
where python >nul 2>nul
if errorlevel 1 (
  if exist "D:\平台\Python312\python.exe" (
    set "PY=D:\平台\Python312\python.exe"
  ) else (
    echo [错误] 未找到 Python，请先安装 Python 3.10 以上版本。
    pause
    exit /b 1
  )
) else (
  set "PY=python"
)

rem ---------- 已在运行则直接开浏览器 ----------
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri '%URL%api/health' -UseBasicParsing -TimeoutSec 2)|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
  echo [OK] 检测到服务已在运行，直接打开浏览器。
  goto openbrowser
)

rem ---------- 启动服务（新窗口） ----------
echo [..] 正在启动本地服务，请稍候……
start "数码考古馆 服务（关闭此窗口即停止）" "%PY%" server\serve.py --port %PORT%

rem ---------- 等待就绪（最多 30 秒） ----------
set /a TRY=0
:wait
set /a TRY+=1
timeout /t 1 >nul
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri '%URL%api/health' -UseBasicParsing -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 goto openbrowser
if %TRY% lss 30 goto wait
echo.
echo [错误] 服务启动超时：请看弹出的服务窗口里的报错。
echo        如果是端口被占用，可改用：python server\serve.py --port 8788
pause
exit /b 1

:openbrowser
echo [OK] 正在打开 %URL%
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "%URL%"
  goto done
)
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" "%URL%"
  goto done
)
start "" "%URL%"
:done
exit /b 0
