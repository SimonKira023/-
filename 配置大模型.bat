@echo off
chcp 936 >nul
title 数码考古馆 · 配置大模型
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo 已生成 .env 配置文件，正在用记事本打开……
) else (
  echo 正在打开已有的 .env 配置文件……
)
start "" notepad ".env"
echo.
echo 请按记事本里的说明填写 API Key，保存后：
echo   1) 关闭本窗口
echo   2) 双击 start.bat 重新启动服务
echo   3) 页面右下角显示「在线 · 大模型讲解」即接入成功
echo.
pause
