"""Mapa de conceitos da matéria: liga a situação que o aluno descreve ao termo que está no slide.

Busca por palavras não sabe que "acerta no treino e erra em dados novos" é overfitting. Cada conceito tem
o que buscar (as palavras do slide) e as pistas: grupos de palavras que, juntos na pergunta, descrevem a
situação. Uma pista vale quando TODAS as palavras dela aparecem (já sem flexão, como a busca compara).
É expansão de consulta com um tesauro do domínio, a técnica clássica de recuperação de informação para
sinônimos; medido em api/eval_situacoes.py.
"""

from __future__ import annotations

from functools import lru_cache

# (o que buscar, [pistas]); cada pista é uma frase curta cujas palavras precisam estar todas na pergunta
CONCEPTS: list[tuple[str, list[str]]] = [
    # Aula 1
    ("teste de Turing", ["conversar perceber humano", "conversar pessoa perceber", "maquina passar humano", "imitar humano conversa", "nao perceber maquina"]),
    ("invernos da IA", ["investimento ia acabou", "dinheiro ia acabou", "interesse ia caiu", "epoca ia esquecida", "ia parou financiamento", "dinheiro interesse ia"]),
    ("IA estreita Narrow AI IA geral AGI", ["faz uma coisa so", "nao sabe fazer mais nada", "so sabe fazer", "ia generica qualquer tarefa", "ia faz tudo humano"]),
    # Aula 2
    ("overfitting generalização", ["treino dado novo", "treino erra novo", "acerta treino erra", "decorando dado", "decorou", "memorizou dado", "memoriza treino", "bem treino mal teste", "treino perfeito producao erra", "nao generaliza"]),
    ("underfitting", ["simples demais erra", "erra treino teste", "erra tudo treino", "nao aprende nem treino", "modelo fraco erra treino"]),
    ("aprendizado supervisionado classificação", ["dado marcado aprender", "ja marcada aprender separar", "rotulo aprender separar", "exemplo resposta certa aprender", "etiqueta aprender categoria", "separar categoria exemplo"]),
    ("regressão aprendizado supervisionado", ["prever preco", "prever valor numero", "prever quanto", "estimar valor", "prever temperatura", "prever venda"]),
    ("aprendizado não supervisionado agrupamento", ["grupo parecido sem", "separar grupo sem etiqueta", "agrupar cliente", "sem rotulo grupo", "segmentar cliente", "nao tenho etiqueta", "sem resposta certa grupo"]),
    ("aprendizado por reforço", ["ganha ponto acerta", "recompensa erro acerto", "pontos acerta perde", "aprende jogar tentativa", "premio punicao", "recompensa punicao"]),
    ("precision falso positivo", ["marca normal fraude", "alarme falso", "acusa errado", "marca errado positivo", "muito falso positivo", "normal como fraude", "spam email bom"]),
    ("recall revocação falso negativo", ["deixou passar doente", "deixa passar", "nao detectou doente", "escapou deteccao", "falso negativo", "perdeu casos"]),
    ("acurácia desbalanceado matriz de confusão F1", ["classe so acerta", "dado desbalanceado", "chutando sempre", "99 acerta classe", "maioria classe acerta"]),
    ("viés variância", ["vies variancia", "equilibrio simples complexo"]),
    ("divisão de dados treino teste validação", ["separar dado teste", "dividir dado treino", "quanto dado teste"]),
    # Aula 3
    ("backpropagation gradiente descendente", ["ajustar peso errar", "descobre ajustar peso", "corrigir peso erro", "aprende com erro peso", "atualiza peso", "quanto ajustar peso"]),
    ("função de ativação ReLU", ["conta linear", "vira linear", "funcao entre camada", "sem funcao rede linear", "nao linear rede"]),
    ("redes convolucionais CNN imagens", ["reconhecer objeto foto", "reconhecer imagem", "rede foto", "classificar imagem", "identificar foto", "objeto imagem rede"]),
    ("RNN gradiente desvanecente LSTM", ["esquecendo comeco texto", "esquece comeco frase", "frase longa esquece", "texto longo esquece", "memoria sequencia longa"]),
    ("transfer learning modelo pré-treinado fine-tuning", ["poucas imagem treinado milhoes", "aproveitar modelo treinado", "poucos dado modelo pronto", "modelo ja treinado aproveitar", "reaproveitar modelo", "ajustando meus exemplo", "estilo negocio ajustar", "ajustar modelo proprio exemplo"]),
    # Aula 4
    ("tokenização", ["quebrar texto pedaco", "dividir texto palavra", "separar texto pedacinho", "texto pedacinho menor"]),
    ("stopwords", ["palavra aparecem demais atrapalham", "tirar palavra comum", "palavras de a o", "palavra sem significado tirar"]),
    ("stemming lematização radical", ["mesma palavra contem", "correndo correu correr", "variacao mesma palavra", "plural singular mesma"]),
    ("análise de sentimentos", ["comentario positivo negativo", "avaliacao positiva negativa", "cliente gostou nao", "opiniao positiva", "positivo negativo automaticamente"]),
    ("word embeddings significado semântico", ["significado parecido", "rei rainha", "palavra parecida significado", "computador entende significado", "sentido palavra numero"]),
    # Aula 5
    ("temperatura top-p criatividade", ["mais criativa variada", "resposta criativa", "resposta variada", "menos repetitiva", "resposta aleatoria", "resposta sempre igual"]),
    ("max_tokens limite de saída", ["resposta cortada meio", "vindo cortada", "resposta incompleta", "corta resposta", "para meio frase"]),
    ("chave de API segura backend", ["chave aparecendo codigo site", "esconder chave", "chave openai site", "chave api frontend", "chave exposta"]),
    # Aula 6
    ("few-shot prompting exemplos", ["exemplo prompt seguir padrao", "alguns exemplo prompt", "mostrar exemplo ia", "exemplo mesmo padrao"]),
    ("chain-of-thought passo a passo", ["pensando passo", "pensar passo", "raciocinar antes responder", "raciocinio passo"]),
    ("limitações dos LLMs alucinação", ["inventa fato", "inventa coisa", "inventa informacao", "mente confianca", "resposta falsa confianca", "alucina"]),
    ("RAG Retrieval-Augmented Generation", ["documento interno empresa", "responder usando documento", "chatbot documento", "pdf responder", "base conhecimento propria", "dado empresa chatbot"]),
    ("como buscar no RAG problema do lexical embeddings", ["palavra exata sinonimo", "nao acha sinonimo", "busca sinonimo", "busca palavra exata", "procurar pelo sentido"]),
    ("janela de contexto memória da conversa", ["esquece falei", "esquece mensagem", "lembrar conversa", "esquece que eu disse", "historico conversa"]),
    ("chunking pipeline RAG", ["documento grande prompt", "grande demais caber prompt", "dividir documento", "texto longo caber", "pedaco documento"]),
    # Aula 7
    ("streaming SSE latência", ["demora tela parada", "usuario esperando resposta", "resposta demora tela", "aparecer aos pouco", "mostrar enquanto gera", "tela parada"]),
    ("Pydantic validação de dados de entrada", ["json campo tipo certo", "json campo tipo", "garantir campo api", "validar json", "validar dado entrada", "campo certo api", "conferir campo chega"]),
    ("fila de tarefas Celery processamento assíncrono", ["tarefa pesada trava", "trava api processando", "processamento demorado bloqueia", "api travada", "tarefa demorada"]),
    ("stateless stateful sessão", ["servidor lembrar usuario", "guardar sessao", "http lembra"]),
    # Aula 8
    ("cold start início frio", ["usuario novo historico", "sem historico recomendar", "acabou cadastrar", "produto novo ninguem avaliou", "item novo sem avaliacao", "novo sem dado recomendar"]),
    ("filtragem colaborativa CF", ["pessoa gosto parecido", "gosto parecido comprou", "gosto parecido compraram", "gente parecida comprou", "usuario parecido", "quem comprou tambem"]),
    ("filtragem baseada em conteúdo", ["parecido genero diretor", "caracteristica item parecido", "mesmo genero", "parecido com que viu"]),
    # Aula 9
    ("inferência no navegador TensorFlow.js cliente", ["rodar navegador", "direto navegador", "sem servidor modelo", "modelo navegador usuario"]),
    ("quantização reduzir modelo", ["pesado celular", "modelo menor", "diminuir modelo", "modelo grande celular", "reduzir tamanho modelo"]),
    # Aula 10
    ("function calling uso de ferramentas", ["consultar api externa", "ia chamar api", "previsao tempo api", "acessar sistema externo", "ia usar ferramenta"]),
    ("padrão ReAct agente", ["pensa executa acao", "pensa age observa", "acao resultado decide", "decide proximo passo", "agente pensa executa"]),
    # Aula 11
    ("viés histórico discriminação", ["rejeita mulher", "discrimina", "aprendeu contratacao antiga", "preconceito modelo", "injusto grupo", "trata diferente grupo"]),
    ("explicabilidade SHAP LIME decisões automatizadas", ["explicar por que negou", "explicar decisao modelo", "por que modelo decidiu", "negou credito", "justificar decisao"]),
    ("LGPD dados pessoais bases legais consentimento", ["dado pessoal treinar", "dados pessoais clientes", "usar dado cliente", "consentimento dado", "privacidade dado"]),
    # Aula 12
    ("AI Act risco inaceitável práticas proibidas", ["nota cidadao", "pontuacao social", "nota comportamento", "permitido europa", "proibido europa"]),
    ("Docker conceitos essenciais Dockerfile container", ["rodar igual qualquer servidor", "empacotar modelo", "igualzinho servidor", "funcionar qualquer maquina", "container modelo"]),
    ("MLOps monitoramento drift", ["producao dado mudaram", "foi piorando", "modelo piorou producao", "depois producao pior", "dados mudaram modelo", "comportamento usuario muda"]),
    ("model cards documentação", ["documentar modelo", "documentar serve limite", "ficha modelo", "documentacao modelo"]),
]


# Vocabulário de cada conceito: palavras que costumam aparecer quando alguém descreve a situação, em qualquer ordem.
# Três delas na pergunta já apontam o conceito, mesmo sem nenhuma pista exata (as pistas decoram uma redação; isto não).
VOCABULARY: dict[str, str] = {
    "teste de Turing": "conversar conversa humano pessoa perceber diferenca maquina enganar imitar passar teste",
    "invernos da IA": "investimento dinheiro interesse financiamento epoca periodo acabou caiu esquecida decada parou promessa",
    "IA estreita Narrow AI IA geral AGI": "tarefa especifica qualquer tarefa intelectual humano geral uma coisa so nada mais existe hoje",
    "overfitting generalização": "treino treinar treinei treinamento exemplos decorou decorar memorizar otimo excelente pessimo ruim novos uso producao teste generalizar",
    "underfitting": "simples demais fraco erra treino teste tudo nao aprende",
    "aprendizado supervisionado classificação": "marcado rotulado rotulo etiqueta categoria separar classificar exemplos respostas certas",
    "regressão aprendizado supervisionado": "prever previsao preco valor numero quanto estimar continuo",
    "aprendizado não supervisionado agrupamento": "sozinho padroes escondidos grupos agrupar segmentar sem rotulo sem etiqueta descobrir",
    "aprendizado por reforço": "recompensa punicao pontos premio jogar tentativa erro acerto ambiente robo",
    "precision falso positivo": "falso alarme fraude spam lixo importante normal marca acusa bloqueia indevido",
    "recall revocação falso negativo": "deixou passar escapou detectar doente perdeu casos nao percebeu",
    "acurácia desbalanceado matriz de confusão F1": "desbalanceado classe rara maioria chutando porcentagem acerto enganosa",
    "backpropagation gradiente descendente": "pesos ajustar corrigir erro camada tras frente atualizar aprende derivada",
    "função de ativação ReLU": "linear funcao camadas nao linear curva",
    "redes convolucionais CNN imagens": "foto fotos imagem imagens objeto objetos identificar reconhecer visual camera",
    "RNN gradiente desvanecente LSTM": "sequencia longa comprida esquece perde sentido comeco frase texto memoria tradutor traducao",
    "transfer learning modelo pré-treinado fine-tuning": "aproveitar reaproveitar adaptar outra empresa treinou pronto pre treinado poucos dados ajustar meu problema",
    "tokenização": "quebrar dividir texto pedacos pedacinhos palavras partes",
    "stopwords": "palavras comuns frequentes tirar remover atrapalham artigos",
    "stemming lematização radical": "mesma palavra variacoes plural singular verbo raiz forma",
    "análise de sentimentos": "avaliacoes comentarios opiniao positivo negativo boas ruins gostou reclamacao medir satisfacao",
    "word embeddings significado semântico": "significado parecido sentido semelhante palavras vetor rei rainha",
    "temperatura top-p criatividade": "criativa variada diferente toda vez mesma pergunta aleatoria repetitiva previsivel",
    "max_tokens limite de saída": "cortada incompleta meio corta tamanho resposta",
    "chave de API segura backend": "chave secreta exposta aparecendo codigo site frontend esconder",
    "few-shot prompting exemplos": "exemplos prompt padrao seguir mostrar formato",
    "chain-of-thought passo a passo": "passo pensar raciocinar raciocinio etapas antes",
    "limitações dos LLMs alucinação": "inventa inventou nem existe falso falsa referencia fonte confianca mentira errado",
    "RAG Retrieval-Augmented Generation": "documentos manual empresa internos base conhecimento propria pdf assistente responder usando",
    "como buscar no RAG problema do lexical embeddings": "sinonimo sinonimos palavra exata busca sentido",
    "janela de contexto memória da conversa": "lembra lembrar esquece conversa nome falei comeco mensagens historico",
    "chunking pipeline RAG": "grande demais caber dividir pedacos documento longo",
    "streaming SSE latência": "aos poucos aparecendo demora espera tela parada igual chatgpt tempo real digitando",
    "Pydantic validação de dados de entrada": "campo faltando tipo errado validar json requisicao quebra entrada formato",
    "fila de tarefas Celery processamento assíncrono": "pesada demorada trava bloqueia fila segundo plano",
    "cold start início frio": "nova novo sem nenhuma compra historico cadastro ainda avaliacao primeiro",
    "filtragem colaborativa CF": "quem viu tambem comprou gosto parecido outros usuarios pessoas parecidas",
    "filtragem baseada em conteúdo": "caracteristicas genero diretor parecidos atributos mesmo tipo",
    "inferência no navegador TensorFlow.js cliente": "navegador browser sem servidor cliente offline",
    "quantização reduzir modelo": "enorme pesado grande celular carregar diminuir reduzir menor leve",
    "function calling uso de ferramentas": "buscar consultar api externa sistema estoque tempo atualizadas informacoes acessar ferramenta",
    "padrão ReAct agente": "pensa age executa acao observa resultado decide proximo",
    "viés histórico discriminação": "discriminacao preconceito mulheres negras injusto erra mais grupo raca genero facial",
    "explicabilidade SHAP LIME decisões automatizadas": "explicar motivo recusa negou decisao justificar por que cliente emprestimo credito",
    "LGPD dados pessoais bases legais consentimento": "cpf dados pessoais guardar consentimento privacidade titular usuarios dataset",
    "AI Act risco inaceitável práticas proibidas": "europa europeia uniao proibido manipular pontuacao social nota cidadaos",
    "Docker conceitos essenciais Dockerfile container": "notebook servidor funciona maquina ambiente empacotar igual container",
    "MLOps monitoramento drift": "mudaram mudou depois pandemia producao comecou errar piorando monitorar ao longo",
    "model cards documentação": "documentar documentacao limites ficha bula",
}


@lru_cache(maxsize=1)
def _compiled() -> list[tuple[str, list[frozenset[str]]]]:
    from api.library import terms

    compiled = []
    for query, hints in CONCEPTS:
        groups = [frozenset(terms(hint)) for hint in hints]
        compiled.append((query, [group for group in groups if group]))
    return compiled


# palavras que aparecem em quase toda pergunta e não dizem de que conceito se trata
GENERIC = frozenset({"modelo", "dado", "ia", "sistema", "usar", "fazer", "resposta", "pergunta", "usuario", "computa", "funcion", "precisa", "consegu", "sobre", "coisa", "algum"})


@lru_cache(maxsize=1)
def _vocabularies() -> list[tuple[str, frozenset[str]]]:
    from api.library import terms

    result = []
    for query, hints in CONCEPTS:
        bag = set(terms(VOCABULARY.get(query, "")))
        for hint in hints:
            bag |= terms(hint)
        result.append((query, frozenset(bag - GENERIC)))
    return result


def concept_queries(question: str, limit: int = 2) -> list[str]:
    """Termos do slide para a situação descrita na pergunta, do conceito com a pista mais completa primeiro."""
    from api.library import terms

    asked = terms(question)

    def present(word: str) -> bool:
        # "ganha" vale para "ganhando", "pedaco" para "pedacinho": mesmo começo de pelo menos 5 letras
        return word in asked or any(len(word) >= 5 and len(other) >= 5 and word[:5] == other[:5] for other in asked)

    # pista exata vale mais (10 + tamanho); sem pista, 3+ palavras do vocabulário do conceito em qualquer ordem
    found: list[tuple[int, str]] = []
    for (query, groups), (_, bag) in zip(_compiled(), _vocabularies()):
        best = max((len(group) for group in groups if all(present(word) for word in group)), default=0)
        overlap = sum(1 for word in bag if present(word))
        score = 10 + best if best else (overlap if overlap >= 3 else 0)
        if score:
            found.append((score, query))
    found.sort(key=lambda item: -item[0])
    return [query for _, query in found[:limit]]


def concept_matches(question: str, limit: int = 2) -> list[tuple[str, bool]]:
    """Como concept_queries, dizendo se veio de uma pista exata (forte) ou só do vocabulário (fraco)."""
    strong = set(concept_queries_strong(question))
    return [(query, query in strong) for query in concept_queries(question, limit)]


def concept_queries_strong(question: str) -> list[str]:
    from api.library import terms

    asked = terms(question)
    hit = []
    for query, groups in _compiled():
        if any(all(word in asked or any(len(word) >= 5 and len(other) >= 5 and word[:5] == other[:5] for other in asked) for word in group) for group in groups):
            hit.append(query)
    return hit
