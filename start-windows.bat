@echo off
chcp 65001 >nul
title Davomat tizimi
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [XATO] Node.js o'rnatilmagan. https://nodejs.org saytidan "LTS" versiyani o'rnating.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo Server paketlari o'rnatilmoqda...
  pushd server
  call npm install --omit=dev
  if errorlevel 1 ( popd & echo [XATO] npm install muvaffaqiyatsiz. Internetni tekshiring. & pause & exit /b 1 )
  popd
)

if not exist "web\out\index.html" (
  echo Web sahifalar tayyorlanmoqda ^(faqat birinchi marta, 2-5 daqiqa^)...
  pushd web
  if not exist "node_modules" call npm install
  call npm run build
  if errorlevel 1 ( popd & echo [XATO] web sahifalar yig'ilmadi & pause & exit /b 1 )
  popd
)

echo.
echo Davomat tizimi ishga tushmoqda. Bu oynani YOPMANG - yopilsa tizim to'xtaydi.
echo Brauzerda: http://localhost:3000
echo.
start "" "http://localhost:3000"
cd server
node --no-warnings=ExperimentalWarning src\index.js
echo.
echo Tizim to'xtadi.
pause
