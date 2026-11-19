@echo off
chcp 65001 >nul
title CS2 Home Panel
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe.
  echo  Telecharge la version LTS sur https://nodejs.org puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installation des dependances, patiente quelques secondes...
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node src\server.js --open
rem En cas d'erreur, la fenetre reste ouverte pour pouvoir lire le message.
if errorlevel 1 pause
