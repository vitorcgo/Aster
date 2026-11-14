@echo off
setlocal
cd /d "%~dp0"
title Aster

where python >nul 2>nul || (echo Instale o Python 3.12 ou superior: https://www.python.org/downloads/ & pause & exit /b 1)
where npm >nul 2>nul || (echo Instale o Node.js 20 ou superior: https://nodejs.org/ & pause & exit /b 1)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Criei o arquivo .env. Coloque sua GEMINI_API_KEY nele ou cadastre a chave pelo painel de modelos.
)

if not exist ".venv\Scripts\python.exe" (
  echo Criando o ambiente Python na primeira execucao...
  python -m venv .venv || (pause & exit /b 1)
  ".venv\Scripts\python.exe" -m pip install -q -r api\requirements.txt || (pause & exit /b 1)
)

if not exist "node_modules" (
  echo Instalando as dependencias do site na primeira execucao...
  call npm install || (pause & exit /b 1)
)

echo Subindo a API em http://127.0.0.1:8000 ...
start "Aster API" /min ".venv\Scripts\python.exe" -m uvicorn api.main:app --host 127.0.0.1 --port 8000

echo Subindo o site em http://127.0.0.1:3000 ...
start "" cmd /c "timeout /t 6 >nul & start http://127.0.0.1:3000"
call npm run dev
