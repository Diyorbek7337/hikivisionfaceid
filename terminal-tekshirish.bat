@echo off
chcp 65001 >nul
rem Terminal bilan aloqani tekshiradi va natijani ekranga chiqaradi.
cd /d "%~dp0server"
:ask_ip
set IP=
set /p IP=Terminal IP manzili (masalan 192.168.31.68): 
if "%IP%"=="" (
  echo IP manzilni kiriting.
  goto ask_ip
)
set USR=
set /p USR=Login [admin]: 
if "%USR%"=="" set USR=admin
set PSW=
set /p PSW=Parol: 
node --no-warnings scripts\terminal-tekshirish.js %IP% %USR% "%PSW%"
echo.
pause
