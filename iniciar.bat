@echo off
setlocal
cd /d "%~dp0"
title Aster

where python >nul 2>nul || (echo Instale o Python 3.12 ou superior: https://www.python.org/downloads/ & pause & exit /b 1)
where npm >nul 2>nul || (echo Instale o Node.js 20 ou superior: https://nodejs.org/ & pause & exit /b 1)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Criei o arquivo .env, que e opcional. A chave de IA se coloca no site, em Modelos de IA.
)

if not exist ".venv\Scripts\python.exe" (
  echo Criando o ambiente Python na primeira execucao...
  python -m venv .venv || (pause & exit /b 1)
)

rem se a instalacao anterior falhou pela metade, a API nao sobe: confere e instala o que faltar
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, pymupdf, google.genai, dotenv, cryptography" >nul 2>nul || (
  echo Instalando as dependencias da API...
  ".venv\Scripts\python.exe" -m pip install -q -r api\requirements.txt || (echo. & echo Nao consegui instalar as dependencias da API. Veja o erro acima. & pause & exit /b 1)
)

if not exist "node_modules" (
  echo Instalando as dependencias do site na primeira execucao...
  call npm install || (pause & exit /b 1)
)

rem um Aster aberto antes (API ou site) prende as portas 8000 e 3000: fecha ele para subir tudo de novo
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000,3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Subindo a API em http://127.0.0.1:8000 ...
rem cmd /k deixa a janela aberta se a API cair, com o erro na tela
start "Aster API" /min cmd /k ".venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000"

echo Subindo o site em http://127.0.0.1:3000 ...
start "" cmd /c "timeout /t 6 >nul & start http://127.0.0.1:3000"
call npm run dev
