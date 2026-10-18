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

rem Ma'lumotlar papkasini faqat shu foydalanuvchi, SYSTEM va administratorlar o'qiy oladigan qilish (bir marta).
if not exist "server\data" mkdir "server\data"
if not exist "server\data\.ruxsat" (
  icacls "server\data" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" >nul 2>&1 && echo ok>"server\data\.ruxsat"
)

echo.
echo Davomat tizimi ishga tushmoqda. Bu oynani YOPMANG - yopilsa tizim to'xtaydi.
echo Port band bo'lsa, keyingi bo'sh port avtomatik tanlanadi. Brauzer o'zi ochiladi.
echo.
cd server
set OPEN_BROWSER=1
node --no-warnings=ExperimentalWarning src\index.js
echo.
echo Tizim to'xtadi.
pause
