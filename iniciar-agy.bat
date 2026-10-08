@echo off
chcp 65001 >nul
title AGY CLI - Google Antigravity
cd /d "%~dp0"
echo =======================================================
echo    🚀 Google Antigravity CLI (AGY) v1.2.2
echo    Pasta de Trabalho: %CD%
echo    Memoria Obsidian: Ativa (.agent\memory)
echo    Regras Anti-Alucinacao: Ativas (.agent\rules)
echo =======================================================
echo.

REM Executa o binário oficial agy.exe
if exist "%~dp0agy.exe" (
    "%~dp0agy.exe" %*
) else (
    agy %*
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [INFO] AGY finalizado.
)
pause
