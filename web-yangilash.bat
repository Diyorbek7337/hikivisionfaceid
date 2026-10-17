@echo off
chcp 65001 >nul
rem Kod yangilangandan keyin web app'ni qayta yig'ish uchun.
cd /d "%~dp0web"
call npm install
call npm run build
echo.
echo Tayyor. Endi start-windows.bat ni ishga tushiring.
pause
