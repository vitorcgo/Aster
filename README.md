# Aster

Agente de estudos da disciplina de Inteligência Artificial. O aluno pergunta, o Aster pesquisa nas aulas, abre a página certa, complementa com a web quando ajuda e responde citando cada fonte. Cada passo do agente aparece ao vivo na tela.

## Executar

Requer Node.js 22+ e Python 3.11+.

**Windows, com dois cliques:** abra o `iniciar.bat`. Na primeira vez ele cria o `.env`, o ambiente Python e instala as dependências; depois sobe a API e o site e abre o navegador.

**Pelo terminal:**

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

`npm run dev` escuta só neste computador, para que ninguém na mesma rede (o Wi-Fi da sala, por exemplo) troque as chaves de IA ou gaste a cota. Para abrir no celular durante o desenvolvimento, use `npm run dev:rede` numa rede confiável.

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

## Modelos, chaves e provedores

O botão de modelo na barra superior abre o painel **Modelos de IA**. Nele dá para:

- colar chaves do **Gemini**, do **ChatGPT** (OpenAI) e da **NVIDIA**; elas ficam em `data/settings.json`, fora do Git, e o navegador só recebe o final mascarado;
- listar os modelos que cada chave enxerga, direto da API do provedor;
- **testar** um modelo: o teste mede o tempo de resposta e confirma se ele chama ferramentas, o que o agente exige;
- montar a **fila do agente**: o Aster usa o primeiro modelo e passa ao próximo se ele falhar, ficar sem cota ou demorar demais.

Sem fila salva, vale a ordem do `.env` (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` e `GEMINI_LAST_RESORT`). As chaves também podem vir de `OPENAI_API_KEY` e `NVIDIA_API_KEY`.

## Laboratório: por dentro do Aster

A rota `/laboratorio` mostra, com os dados reais do sistema, o caminho de uma pergunta dentro do Aster. Cada etapa é explicada pela aula correspondente e usa a última pergunta feita na tela Estudar (ou outra digitada ali):

1. **Ingestão e chunking** (Aula 6, p. 33-34): os 12 PDFs viram 499 páginas e 2.277 trechos; mostra o texto cru do PyMuPDF, os caracteres corrompidos corrigidos e os trechos com id.
2. **PLN da pergunta** (Aula 4, p. 6-9): normalização, tokenização, stopwords e stemming, com as mesmas funções da busca.
3. **Busca e ranking** (Aula 6, p. 24): a pontuação de cada candidato e o “problema do lexical”.
4. **Embeddings** (Aula 6, p. 25-27): vetores reais do `gemini-embedding-001`, similaridade de cosseno e comparação com a ordem lexical.
5. **Rede neural reranker** (Aula 3 e Aula 10, p. 22): uma MLP treinada no navegador com os pares reais de pergunta e trecho, com validação que deixa cada pergunta de fora.
6. **Agente e ferramentas** (Aula 6, p. 8; Aula 10, p. 9-13): o system prompt real marcado por papel, restrições, formato e tom, as ferramentas do function calling e o ciclo ReAct da consulta.
7. **Streaming com SSE** (Aula 7, p. 16-22): o modelo Pydantic, a `StreamingResponse` e os eventos crus com o tempo de cada um.
8. **Avaliação** (Aula 2, p. 31-33): 26 perguntas com a página certa conferida (`api/eval_set.py`). Anéis mostram em quantas a página veio em 1º, entre as 3 e entre as 6 que o agente lê; um placar mostra cada pergunta e compara com a rede neural. Recall, precisão e MRR ficam num bloco de termos técnicos.

Quando o Aster cita uma página coberta por uma etapa, a resposta oferece abri-la no Laboratório.

## Modelos e erros

`GEMINI_MODEL` define o modelo principal e `GEMINI_FALLBACK_MODEL` o reserva. Se o principal falhar por indisponibilidade, limite ou resposta inválida, o agente recomeça com o reserva. Erros de chave, cobrança e permissão aparecem sem detalhes internos. `GEMINI_THINKING` ajusta o nível de raciocínio (`minimal`, `low`, `medium`, `high`; padrão `low`).

O Google Search exige cota de busca no projeto do Gemini. Se a chave devolver 429 para a busca, o Aster usa a Wikipédia por 15 minutos e tenta o Google de novo depois. `ASTER_WEB_GOOGLE=0` desliga o Google de vez.

## Rotas da API

A documentação interativa fica em `http://127.0.0.1:8000/docs` (Swagger) e `/redoc`.

| Método | Rota | O que faz |
| --- | --- | --- |
| `POST` | `/api/tutor/runs` | Faz uma pergunta e recebe os passos do agente em SSE |
| `GET` | `/api/health` | Mostra se a API está no ar e quais modelos estão configurados |
| `GET` | `/api/materials` | Lista as aulas indexadas |
| `GET` | `/api/materials/{aula}/pdf` e `/pages/{página}` | Entrega o PDF e o texto de uma página |
| `GET`, `PUT`, `DELETE` | `/api/settings/...` | Chaves e fila de modelos (só no próprio computador) |
| `GET`, `POST` | `/api/providers/{provedor}/models` e `/test` | Lista e testa modelos de um provedor |
| `GET` | `/api/lab/...` | Dados reais de cada etapa do Laboratório |

Todo erro volta no mesmo formato, com uma mensagem em português:

```json
{ "detail": { "code": "invalid_request", "message": "Requisição inválida: pergunta: precisa ter pelo menos 3 caracteres." } }
```

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `invalid_request` | Pergunta vazia, longa demais ou JSON malformado |
| 403 | `local_only` | Tentativa de mudar chaves a partir de outro computador |
| 404 | `route_not_found` | Rota inexistente |
| 405 | `method_not_allowed` | Método HTTP errado |
| 413 | `payload_too_large` | Corpo maior que 64 KB |
| 429 | `too_many_questions` | Mais perguntas por minuto do que o limite, com `Retry-After` |
| 500 | `internal_error` | Erro inesperado; o detalhe fica só no log do servidor |

Falhas do modelo durante uma pergunta (sem cota, fora do ar, resposta inválida) não viram erro HTTP: chegam como evento `model_fallback` e o próximo modelo da fila assume.

## Segurança

- **Chaves:** ficam no `.env` ou em `data/settings.json`, ambos fora do Git. O navegador só recebe o final mascarado.
- **Só no próprio computador:** `npm run dev` escuta em 127.0.0.1, e as rotas de chaves recusam pedidos de outros IPs.
- **Limite de perguntas:** 12 por minuto por IP (`ASTER_PERGUNTAS_POR_MINUTO`, 0 desliga).
- **Dados pessoais:** CPF, cartão, e-mail e telefone são trocados por marcadores antes de a pergunta ir para a IA ou para a busca na web, e a resposta avisa o que foi ocultado.
- **Prompt injection:** a pergunta vai entre `<pergunta_do_aluno>` e o system prompt manda tratar a pergunta, a conversa e tudo o que as ferramentas devolvem (slides e páginas da web) como dado, nunca como instrução.
- **Citações conferidas:** o servidor recusa respostas que citem fontes que a IA não recebeu.

## Materiais

Os arquivos `Aula 1.pdf` a `Aula 12.pdf` na raiz entram na busca. Outros PDFs podem ser colocados em `data/materials/`. Ambos os locais são ignorados pelo Git. `Prova 1.pdf` fica fora da busca. PPTX deve ser exportado para PDF antes. Páginas digitalizadas sem texto ainda não são indexadas.

## Simulados

A rota `/simulados` tem 12 questões em três níveis, com correção a cada questão ou só no final. Cada gabarito aponta a página da aula que o sustenta, e o link abre essa página na tela de estudo com o trecho marcado.

## Testes

```powershell
.\.venv\Scripts\python.exe -m unittest api.test_main
npm run typecheck
```
