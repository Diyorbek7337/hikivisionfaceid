@echo off
chcp 65001 >nul
title Davomat - ko'prik
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [XATO] Node.js o'rnatilmagan. https://nodejs.org dan "LTS" versiyani o'rnating.
  pause
  exit /b 1
)

if not exist "bridge\serviceAccountKey.json" (
  echo.
  echo [XATO] bridge\serviceAccountKey.json topilmadi.
  echo Firebase Console - Project settings - Service accounts - "Generate new private key".
  echo Yuklab olingan faylni bridge papkasiga serviceAccountKey.json nomi bilan qo'ying.
  echo Batafsil: README.md
  pause
  exit /b 1
)

if not exist "bridge\firebase-web-config.json" (
  echo.
  echo [XATO] bridge\firebase-web-config.json topilmadi.
  echo Firebase Console - Project settings - Your apps - Web app - "firebaseConfig" ni
  echo nusxalab, shu nomdagi faylga joylang. Batafsil: README.md
  pause
  exit /b 1
)

if not exist "bridge\.env" (
  copy "bridge\.env.example" "bridge\.env" >nul
  echo.
  echo bridge\.env yaratildi. Bloknot ochiladi: ADMIN_EMAILS= qatoriga o'z emailingizni yozing,
  echo saqlang va Bloknotni yoping.
  notepad "bridge\.env"
)

if not exist "bridge\node_modules" (
  echo Ko'prik paketlari o'rnatilmoqda...
  pushd bridge
  call npm install --omit=dev
  if errorlevel 1 ( popd & echo [XATO] npm install muvaffaqiyatsiz & pause & exit /b 1 )
  popd
)

if not exist "web\out\index.html" (
  echo Web app tayyorlanmoqda ^(birinchi marta 2-5 daqiqa^)...
  pushd web
  if not exist "node_modules" call npm install
  call npm run build
  if errorlevel 1 ( popd & echo [XATO] web app yig'ilmadi & pause & exit /b 1 )
  popd
)

echo.
echo Ko'prik ishga tushmoqda. Bu oynani YOPMANG - yopilsa terminallar bilan aloqa uziladi.
echo Web app: http://localhost:3000
echo.
start "" "http://localhost:3000"
cd bridge
node src\index.js
echo.
echo Ko'prik to'xtadi.
pause
