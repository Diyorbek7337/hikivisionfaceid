@echo off
chcp 65001 >nul
rem Windows Firewall da 3000-portni ochadi, shunda terminallar shu kompyuterga event yubora oladi.
rem Bu faylni sichqonchaning o'ng tugmasi bilan bosib "Run as administrator" orqali ishga tushiring.
net session >nul 2>&1
if errorlevel 1 (
  echo [XATO] Administrator sifatida ishga tushiring: o'ng tugma - "Run as administrator".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Davomat server 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Davomat server 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.
echo Tayyor: 3000-port ochildi.
pause
