#!/bin/bash
# Aster no Mac: dois cliques neste arquivo sobem a API e o site e abrem o navegador.
# Na primeira vez ele cria o .env, o ambiente Python e instala as dependências (igual ao iniciar.bat do Windows).

cd "$(dirname "$0")" || exit 1

fechar() {
  echo
  read -n 1 -s -r -p "Aperte qualquer tecla para fechar esta janela..."
  echo
  exit "${1:-1}"
}

# o Python que vem com o macOS é antigo (3.9); o Aster precisa do 3.12 ou mais novo
PYTHON=""
for candidato in python3.14 python3.13 python3.12 python3; do
  if command -v "$candidato" >/dev/null 2>&1 && "$candidato" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    PYTHON="$candidato"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "Instale o Python 3.12 ou superior: https://www.python.org/downloads/macos/"
  echo "(ou, com o Homebrew: brew install python@3.12)"
  fechar 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Instale o Node.js 20 ou superior: https://nodejs.org/"
  echo "(ou, com o Homebrew: brew install node)"
  fechar 1
fi

if [ ! -f ".env" ]; then
  cp ".env.example" ".env"
  echo "Criei o arquivo .env, que é opcional. A chave de IA se coloca no site, em Modelos de IA."
fi

# se a pasta veio de um Windows, o .venv de lá não roda no Mac: o Mac ganha um ambiente próprio
VENV=".venv"
if [ -d ".venv" ] && [ ! -x ".venv/bin/python" ]; then
  VENV=".venv-mac"
fi
if [ ! -x "$VENV/bin/python" ]; then
  echo "Criando o ambiente Python na primeira execução..."
  "$PYTHON" -m venv "$VENV" || fechar 1
  "$VENV/bin/python" -m pip install -q -r api/requirements.txt || fechar 1
fi

if [ ! -d "node_modules" ]; then
  echo "Instalando as dependências do site na primeira execução..."
  npm install || fechar 1
fi

echo "Subindo a API em http://127.0.0.1:8000 ..."
"$VENV/bin/python" -m uvicorn api.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!
# fechar a janela ou apertar Ctrl+C também desliga a API
trap 'kill "$API_PID" 2>/dev/null' EXIT INT TERM

echo "Subindo o site em http://127.0.0.1:3000 ..."
(sleep 6 && open "http://127.0.0.1:3000") &
npm run dev
