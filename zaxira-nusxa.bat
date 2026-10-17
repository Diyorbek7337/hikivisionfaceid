@echo off
chcp 65001 >nul
rem Kunlik zaxira nusxalar papkasini ochadi (fleshkaga ko'chirib qo'yish uchun).
cd /d "%~dp0"
if not exist "server\data\backups" mkdir "server\data\backups"
start "" explorer "server\data\backups"
