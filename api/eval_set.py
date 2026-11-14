"""Perguntas com a página esperada, usadas para medir a busca do Aster (Aula 2, precisão e recall)
e para treinar o reranker neural do Laboratório (Aula 3 e Aula 10, p. 22).

As 12 primeiras são as questões dos simulados (lib/questions.ts); as demais perguntam sobre
os conceitos que o próprio Aster usa. Cada página foi conferida pelo título do slide.
"""

EVAL_SET: list[dict] = [
    # simulados
    {"q": "Em 1950, Alan Turing propôs um teste para medir a inteligência de uma máquina. Qual é o critério central desse teste?", "doc": "aula-1", "page": 10, "origin": "simulado"},
    {"q": "O que caracteriza o aprendizado supervisionado?", "doc": "aula-2", "page": 7, "origin": "simulado"},
    {"q": "O que são embeddings?", "doc": "aula-6", "page": 25, "origin": "simulado"},
    {"q": "Qual função de ativação a Aula 3 aponta como a mais popular atualmente em Deep Learning?", "doc": "aula-3", "page": 9, "origin": "simulado"},
    {"q": "Um modelo acerta quase tudo nos dados de treino, mas erra muito em dados novos. O que está acontecendo?", "doc": "aula-2", "page": 22, "origin": "simulado"},
    {"q": "Por que um pipeline de RAG divide os documentos em chunks antes de gerar os embeddings?", "doc": "aula-6", "page": 34, "origin": "simulado"},
    {"q": "Em qual situação o few-shot prompting é mais indicado?", "doc": "aula-6", "page": 14, "origin": "simulado"},
    {"q": "Uma rede precisa classificar imagens em 10 categorias diferentes. Qual função é a escolha padrão para a última camada?", "doc": "aula-3", "page": 10, "origin": "simulado"},
    {"q": "Um classificador de fraudes passa a só marcar um caso como fraude quando tem muita certeza. O que tende a acontecer com as métricas?", "doc": "aula-2", "page": 33, "origin": "simulado"},
    {"q": "Uma loja lança produtos novos que ninguém avaliou ainda. Qual abordagem de recomendação consegue sugeri-los desde o primeiro dia?", "doc": "aula-8", "page": 7, "origin": "simulado"},
    {"q": "Como o backpropagation descobre quanto cada peso contribuiu para o erro da rede?", "doc": "aula-3", "page": 15, "origin": "simulado"},
    {"q": "Depois do deploy, o comportamento dos usuários muda e um agente de IA começa a errar mais. Qual prática da aula trata esse problema?", "doc": "aula-10", "page": 48, "origin": "simulado"},
    # conceitos que o Aster usa
    {"q": "O que é tokenização em PLN?", "doc": "aula-4", "page": 7, "origin": "sistema"},
    {"q": "Por que remover stopwords do texto?", "doc": "aula-4", "page": 8, "origin": "sistema"},
    {"q": "O que é stemming?", "doc": "aula-4", "page": 9, "origin": "sistema"},
    {"q": "Como o TF-IDF equilibra a importância das palavras?", "doc": "aula-4", "page": 14, "origin": "sistema"},
    {"q": "O que deve ter um bom system prompt?", "doc": "aula-6", "page": 8, "origin": "sistema"},
    {"q": "Qual é o problema da busca lexical em um RAG?", "doc": "aula-6", "page": 24, "origin": "sistema"},
    {"q": "Como calcular a similaridade entre dois vetores?", "doc": "aula-6", "page": 27, "origin": "sistema"},
    {"q": "O que acontece na fase de recuperação do RAG?", "doc": "aula-6", "page": 36, "origin": "sistema"},
    {"q": "O que são Server-Sent Events?", "doc": "aula-7", "page": 20, "origin": "sistema"},
    {"q": "Para que serve o Pydantic no FastAPI?", "doc": "aula-7", "page": 16, "origin": "sistema"},
    {"q": "Como funciona o padrão ReAct de um agente?", "doc": "aula-10", "page": 9, "origin": "sistema"},
    {"q": "O que é function calling?", "doc": "aula-10", "page": 13, "origin": "sistema"},
    {"q": "O que é reranking na recuperação de documentos?", "doc": "aula-10", "page": 22, "origin": "sistema"},
    {"q": "Qual a fórmula do recall?", "doc": "aula-2", "page": 32, "origin": "sistema"},
]
