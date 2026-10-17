@echo off
chcp 65001 >nul
rem Yangi versiya fayllari ko'chirilgandan keyin ishga tushiring: paketlar va web sahifalar qayta yig'iladi.
rem Ma'lumotlar (server\data) o'zgarmaydi.
cd /d "%~dp0"
pushd server
call npm install --omit=dev
popd
pushd web
call npm install
call npm run build
popd
echo.
echo Tayyor. Endi start-windows.bat ni ishga tushiring.
pause
