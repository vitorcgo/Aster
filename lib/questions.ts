export type Level = "facil" | "medio" | "dificil";

export type Question = {
  id: string;
  level: Level;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  source: { document_id: string; page: number; query: string };
};

export const LEVEL_LABEL: Record<Level, string> = { facil: "Fácil", medio: "Médio", dificil: "Difícil" };

/** Cada gabarito foi conferido na página indicada do PDF da aula. */
export const QUESTIONS: Question[] = [
  {
    id: "turing",
    level: "facil",
    prompt: "Em 1950, Alan Turing propôs um teste para medir a inteligência de uma máquina. Qual é o critério central desse teste?",
    options: ["Resolver cálculos mais rápido que uma pessoa", "Se passar por um humano em um diálogo", "Vencer um campeão mundial de xadrez", "Aprender sem nenhum dado rotulado"],
    answer: 1,
    explanation: "Segundo a Aula 1, a inteligência de máquina seria demonstrada se o sistema conseguisse se passar por um humano em uma conversa.",
    source: { document_id: "aula-1", page: 10, query: "Teste de Turing se passar por um humano" },
  },
  {
    id: "supervisionado",
    level: "facil",
    prompt: "O que caracteriza o aprendizado supervisionado?",
    options: ["O modelo aprende por tentativa e erro com recompensas", "O modelo agrupa dados sem nenhum rótulo", "O modelo aprende a partir de dados previamente rotulados", "O modelo é programado regra por regra"],
    answer: 2,
    explanation: "A Aula 2 define o aprendizado supervisionado como aquele em que o modelo aprende com um conjunto de treino de dados já rotulados.",
    source: { document_id: "aula-2", page: 7, query: "Aprendizado Supervisionado dados previamente rotulados" },
  },
  {
    id: "embeddings",
    level: "facil",
    prompt: "O que são embeddings?",
    options: ["Representações matemáticas, em vetores numéricos, de textos, imagens ou áudios", "Arquivos PDF compactados para o modelo ler", "Regras escritas à mão para filtrar respostas", "Senhas usadas para acessar a API do modelo"],
    answer: 0,
    explanation: "Na Aula 6, embeddings são vetores numéricos que representam conteúdo; textos com significado parecido ficam próximos no espaço.",
    source: { document_id: "aula-6", page: 25, query: "Embeddings são representações matemáticas" },
  },
  {
    id: "relu",
    level: "facil",
    prompt: "Qual função de ativação a Aula 3 aponta como a mais popular atualmente em Deep Learning?",
    options: ["Sigmoid", "Softmax", "ReLU", "Degrau"],
    answer: 2,
    explanation: "A ReLU zera valores negativos e mantém os positivos, f(x) = max(0, x), e é a mais usada hoje em Deep Learning.",
    source: { document_id: "aula-3", page: 9, query: "ReLU função de ativação mais popular" },
  },
  {
    id: "overfitting",
    level: "medio",
    prompt: "Um modelo acerta quase tudo nos dados de treino, mas erra muito em dados novos. O que está acontecendo?",
    options: ["Underfitting, porque o modelo é simples demais", "Overfitting, porque o modelo se ajustou a ruídos e particularidades do treino", "Vazamento de dados entre treino e teste", "Falta de função de ativação na saída"],
    answer: 1,
    explanation: "A Aula 2 explica que no overfitting o modelo se ajusta demais ao treino e perde a capacidade de generalizar para novas amostras.",
    source: { document_id: "aula-2", page: 22, query: "Overfitting ajusta excessivamente particularidades" },
  },
  {
    id: "chunking",
    level: "medio",
    prompt: "Por que um pipeline de RAG divide os documentos em chunks antes de gerar os embeddings?",
    options: ["Para economizar espaço em disco", "Porque o LLM só lê textos em inglês", "Para enviar só os pedaços relevantes e não diluir a precisão do embedding", "Para impedir que o aluno veja o documento original"],
    answer: 2,
    explanation: "Pela Aula 6, o LLM tem limite de contexto e um texto enorme dilui o embedding; pedaços menores capturam ideias específicas.",
    source: { document_id: "aula-6", page: 34, query: "Chunking enviar apenas os pedaços relevantes" },
  },
  {
    id: "fewshot",
    level: "medio",
    prompt: "Em qual situação o few-shot prompting é mais indicado?",
    options: ["Quando a resposta precisa seguir um formato muito específico ou a tarefa é incomum", "Quando não há nenhum exemplo disponível", "Quando queremos reduzir o modelo para rodar no celular", "Quando o modelo precisa ser treinado do zero"],
    answer: 0,
    explanation: "A Aula 6 descreve o few-shot como aprendizado em contexto: alguns exemplos de entrada e saída guiam formatos específicos ou tarefas pouco comuns.",
    source: { document_id: "aula-6", page: 14, query: "Few-Shot Uso ideal respostas formatadas" },
  },
  {
    id: "softmax",
    level: "medio",
    prompt: "Uma rede precisa classificar imagens em 10 categorias diferentes. Qual função é a escolha padrão para a última camada?",
    options: ["ReLU", "Softmax", "LeakyReLU", "Sigmoid em cada neurônio, sem normalizar"],
    answer: 1,
    explanation: "Segundo a Aula 3, o Softmax é o padrão na última camada de classificação multiclasse, porque as saídas somam 1 e viram probabilidades.",
    source: { document_id: "aula-3", page: 10, query: "Softmax escolha padrão classificação multiclasse" },
  },
  {
    id: "precisao-recall",
    level: "dificil",
    prompt: "Um classificador de fraudes passa a só marcar um caso como fraude quando tem muita certeza. O que tende a acontecer com as métricas?",
    options: ["Precisão e recall sobem juntos", "A precisão sobe e o recall cai", "O recall sobe e a precisão cai", "As duas métricas ficam iguais ao F1-Score"],
    answer: 1,
    explanation: "A Aula 2 mostra o trade-off: classificar de forma restritiva eleva a precisão, mas reduz o recall; o F1-Score equilibra as duas.",
    source: { document_id: "aula-2", page: 33, query: "classificar tudo restritivamente eleva precisão mas reduz recall" },
  },
  {
    id: "cold-start",
    level: "dificil",
    prompt: "Uma loja lança produtos novos que ninguém avaliou ainda. Qual abordagem de recomendação consegue sugeri-los desde o primeiro dia?",
    options: ["Filtragem colaborativa baseada em usuários", "Fatoração de matrizes das avaliações", "Filtragem baseada em conteúdo, usando os metadados dos itens", "Ranking por número de avaliações recebidas"],
    answer: 2,
    explanation: "A Aula 8 lista como vantagem da filtragem baseada em conteúdo não sofrer cold start para itens novos: basta ter os metadados.",
    source: { document_id: "aula-8", page: 7, query: "Não sofre do problema de Cold Start para itens novos" },
  },
  {
    id: "backprop",
    level: "dificil",
    prompt: "Como o backpropagation descobre quanto cada peso contribuiu para o erro da rede?",
    options: ["Testando pesos aleatórios até o erro cair", "Partindo da perda final e aplicando a regra da cadeia de trás para frente", "Comparando a saída com a de outra rede já treinada", "Somando os pesos de todas as camadas"],
    answer: 1,
    explanation: "A Aula 3 explica que o backpropagation começa pela perda final e volta camada por camada com a regra da cadeia, calculando a contribuição de cada parâmetro.",
    source: { document_id: "aula-3", page: 15, query: "Backpropagation inicia com o valor da perda final" },
  },
  {
    id: "drift",
    level: "dificil",
    prompt: "Depois do deploy, o comportamento dos usuários muda e um agente de IA começa a errar mais. Qual prática da aula trata esse problema?",
    options: ["Aumentar a temperatura do modelo", "Monitorar continuamente o drift de dados e de conceito", "Remover o histórico de conversas", "Trocar o banco de dados por planilhas"],
    answer: 1,
    explanation: "A Aula 10 recomenda monitorar continuamente a degradação de desempenho e as mudanças de comportamento dos usuários (concept drift e data drift).",
    source: { document_id: "aula-10", page: 48, query: "Monitoramento de Drift Concept Drift Data Drift" },
  },
];
