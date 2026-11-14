# Aster

Agente de estudos da disciplina de Inteligência Artificial. O aluno pergunta, o Aster pesquisa nas aulas, abre a página certa, complementa com a web quando ajuda e responde citando cada fonte. Cada passo do agente aparece ao vivo na tela.

## Executar

Requer Node.js 22+ e Python 3.11+.

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m uvicorn api.main:app --port 8000
```

Em outro terminal:

```powershell
npm run dev
```

Antes de iniciar a API, preencha `GEMINI_API_KEY` no `.env`. Reinicie a API depois de alterar esse arquivo. Abra `http://localhost:3000`.

Para usar a API em outra porta, defina `ASTER_API_ORIGIN` antes de iniciar o Next, por exemplo `$env:ASTER_API_ORIGIN = "http://127.0.0.1:8010"`.

## Como o agente trabalha

A API (`api/main.py`) entrega ao Gemini estas ferramentas, e o modelo decide quais usar e em que ordem:

| Ferramenta | O que faz |
| --- | --- |
| `buscar_nas_aulas` | Busca por palavras-chave nos trechos dos 12 PDFs, com tolerância a plural e sufixos. A IA escolhe os termos e pode restringir a uma aula. |
| `ler_pagina` | Abre uma página inteira e devolve os trechos citáveis dela. |
| `pesquisar_na_web` | Pesquisa na internet. Usa o Google Search do Gemini quando a cota permite; se não, a Wikipédia. |
| `responder` | Entrega a resposta em blocos, cada um com os ids das fontes. O servidor recusa ids que a IA não recebeu das ferramentas, e a IA corrige. |
| `conversar` | Responde cumprimentos e perguntas sobre o próprio Aster, sem pesquisa. |
| `sem_base` | Usada quando nem as aulas nem a web sustentam uma resposta. |

Cada chamada de ferramenta vira um evento SSE (`tool_call`, `search_results`, `page_read`, `web_results`, `answer_check`, `answer_ready`). A interface encena esses eventos: o cursor Aster vai até o nó, a página abre, o trecho citado é selecionado e a resposta é escrita. Em cada ferramenta a IA informa, numa frase, por que está fazendo aquilo; essa frase aparece na tela.

Sem `GEMINI_API_KEY`, a API roda um caminho fixo (busca, leitura da primeira página, trechos copiados) e a interface avisa que não há IA envolvida.

## Modelos e erros

`GEMINI_MODEL` define o modelo principal e `GEMINI_FALLBACK_MODEL` o reserva. Se o principal falhar por indisponibilidade, limite ou resposta inválida, o agente recomeça com o reserva. Erros de chave, cobrança e permissão aparecem sem detalhes internos. `GEMINI_THINKING` ajusta o nível de raciocínio (`minimal`, `low`, `medium`, `high`; padrão `low`).

O Google Search exige cota de busca no projeto do Gemini. Se a chave devolver 429 para a busca, o Aster usa a Wikipédia por 15 minutos e tenta o Google de novo depois. `ASTER_WEB_GOOGLE=0` desliga o Google de vez.

## Materiais

Os arquivos `Aula 1.pdf` a `Aula 12.pdf` na raiz entram na busca. Outros PDFs podem ser colocados em `data/materials/`. Ambos os locais são ignorados pelo Git. `Prova 1.pdf` fica fora da busca. PPTX deve ser exportado para PDF antes. Páginas digitalizadas sem texto ainda não são indexadas.

## Simulados

A rota `/simulados` tem 12 questões em três níveis, com correção a cada questão ou só no final. Cada gabarito aponta a página da aula que o sustenta, e o link abre essa página na tela de estudo com o trecho marcado.

## Testes

```powershell
.\.venv\Scripts\python.exe -m unittest api.test_main
npm run typecheck
```
