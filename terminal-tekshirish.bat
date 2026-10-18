@echo off
chcp 65001 >nul
rem Terminal bilan aloqani tekshiradi va natijani ekranga chiqaradi.
setlocal EnableDelayedExpansion
cd /d "%~dp0server"
:ask_ip
set "IP="
set /p "IP=Terminal IP manzili (masalan 192.168.31.68): "
if not defined IP (
  echo IP manzilni kiriting.
  goto ask_ip
)
set "USR="
set /p "USR=Login [admin]: "
if not defined USR set "USR=admin"
set "PSW="
set /p "PSW=Parol: "
rem Qiymatlar buyruq qatorida emas, muhit o'zgaruvchilari orqali uzatiladi (maxsus belgilar buzilmasligi uchun).
set "TERMINAL_IP=!IP!"
set "TERMINAL_USER=!USR!"
set "TERMINAL_PASSWORD=!PSW!"
node --no-warnings scripts\terminal-tekshirish.js
set "TERMINAL_PASSWORD="
set "PSW="
echo.
pause
