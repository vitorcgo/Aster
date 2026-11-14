export type DemoId = "rede" | "convolucao" | "embeddings" | "overfitting";

type LecturePage = { document_id: string; page: number; label: string; query: string };

export type Demo = {
  id: DemoId;
  title: string;
  lecture: string;
  summary: string;
  pages: LecturePage[];
  // páginas das aulas que, se citadas pelo Aster, sugerem esta demonstração
  covers: { document_id: string; from: number; to: number }[];
};

export const DEMOS: Demo[] = [
  {
    id: "rede",
    title: "Rede neural",
    lecture: "Aula 3",
    summary: "Uma MLP de verdade treinando no navegador. Tire a camada oculta e veja o perceptron falhar no XOR.",
    pages: [
      { document_id: "aula-3", page: 4, label: "Perceptron, p. 4", query: "Perceptron soma ponderada XOR" },
      { document_id: "aula-3", page: 5, label: "MLP, p. 5", query: "Multilayer Perceptron camadas ocultas" },
      { document_id: "aula-3", page: 16, label: "Loop de treino, p. 16", query: "loop de treinamento forward pass backward pass" },
    ],
    covers: [{ document_id: "aula-3", from: 3, to: 16 }],
  },
  {
    id: "convolucao",
    title: "Convolução e pooling",
    lecture: "Aula 3",
    summary: "Um filtro 3 × 3 desliza pela imagem, gera o mapa de características e o max-pooling reduz a dimensão.",
    pages: [
      { document_id: "aula-3", page: 23, label: "Convolução, p. 23", query: "convolução desliza filtro kernel feature maps" },
      { document_id: "aula-3", page: 24, label: "Padding e stride, p. 24", query: "Padding Strides" },
      { document_id: "aula-3", page: 25, label: "Pooling, p. 25", query: "Max-Pooling" },
    ],
    covers: [{ document_id: "aula-3", from: 21, to: 26 }],
  },
  {
    id: "embeddings",
    title: "Embeddings",
    lecture: "Aula 6",
    summary: "Palavras viram vetores, e significados parecidos ficam perto. Rei − Homem + Mulher cai em Rainha.",
    pages: [
      { document_id: "aula-6", page: 25, label: "Embeddings, p. 25", query: "Embeddings são representações matemáticas" },
      { document_id: "aula-6", page: 26, label: "Exemplo, p. 26", query: "Vetor Rei Homem Mulher Rainha" },
    ],
    covers: [{ document_id: "aula-6", from: 24, to: 27 }, { document_id: "aula-4", from: 14, to: 16 }],
  },
  {
    id: "overfitting",
    title: "Overfitting",
    lecture: "Aula 2",
    summary: "Aumente a complexidade do modelo: o erro no treino cai, mas o da validação dispara quando ele decora o ruído.",
    pages: [
      { document_id: "aula-2", page: 22, label: "Overfitting, p. 22", query: "Overfitting ajusta excessivamente" },
      { document_id: "aula-2", page: 24, label: "Como evitar, p. 24", query: "evitar overfitting" },
    ],
    covers: [{ document_id: "aula-2", from: 21, to: 25 }],
  },
];

export function demoForPage(documentId: string, page: number) {
  return DEMOS.find((demo) => demo.covers.some((range) => range.document_id === documentId && page >= range.from && page <= range.to)) ?? null;
}
