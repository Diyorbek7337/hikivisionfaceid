@echo off
chcp 65001 >nul
title Davomat tizimi
cd /d "%~dp0"

rem Port: server\.env dagi PORT= qiymati (bo'lmasa 3000)
set PORT=3000
if exist "server\.env" (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" "server\.env"') do if not "%%b"=="" set PORT=%%b
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [XATO] Node.js o'rnatilmagan. https://nodejs.org saytidan "LTS" versiyani o'rnating.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo [XATO] %PORT%-port band. Ehtimol tizim allaqachon ochiq ^(boshqa qora oynani yoping^),
  echo yoki bu portni boshqa dastur ishlatyapti. Boshqa port tanlash uchun:
  echo   server\.env faylida PORT=3050 deb yozing ^(fayl yo'q bo'lsa server\.env.example dan nusxalang^).
  echo Portni band qilgan dastur:
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do tasklist /fi "PID eq %%p" /fo list | findstr /i "Image PID"
  echo.
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
echo Brauzerda: http://localhost:%PORT%
echo.
start "" "http://localhost:%PORT%"
cd server
node --no-warnings=ExperimentalWarning src\index.js
echo.
echo Tizim to'xtadi.
pause
