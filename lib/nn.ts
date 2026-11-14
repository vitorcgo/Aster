/**
 * Rede neural densa (MLP) pequena, treinada no navegador com o loop da Aula 3, p. 16:
 * mini-batch, forward pass, perda, backward pass (backpropagation) e atualização θ ← θ − α∇J.
 */

export type Activation = "relu" | "leaky" | "sigmoid" | "tanh";
export type Sample = { x: [number, number]; y: 0 | 1 };

export type Network = {
  sizes: number[];
  activation: Activation;
  weights: number[][][]; // weights[l][j][i]: do neurônio i da camada l para o j da camada l+1
  biases: number[][];
};

export type ForwardTrace = { z: number[][]; a: number[][] };

function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createNetwork(sizes: number[], activation: Activation, seed = 7): Network {
  const random = rng(seed);
  const gaussian = () => Math.sqrt(-2 * Math.log(random() + 1e-9)) * Math.cos(2 * Math.PI * random());
  const weights: number[][][] = [];
  const biases: number[][] = [];
  for (let layer = 0; layer < sizes.length - 1; layer++) {
    const fanIn = sizes[layer];
    const scale = activation === "relu" || activation === "leaky" ? Math.sqrt(2 / fanIn) : Math.sqrt(1 / fanIn);
    weights.push(Array.from({ length: sizes[layer + 1] }, () => Array.from({ length: fanIn }, () => gaussian() * scale)));
    biases.push(Array.from({ length: sizes[layer + 1] }, () => (activation === "relu" ? 0.1 : 0)));
  }
  return { sizes, activation, weights, biases };
}

export function activate(kind: Activation, z: number) {
  switch (kind) {
    case "relu": return Math.max(0, z);
    case "leaky": return z > 0 ? z : 0.05 * z;
    case "sigmoid": return 1 / (1 + Math.exp(-z));
    case "tanh": return Math.tanh(z);
  }
}

function derivative(kind: Activation, z: number, a: number) {
  switch (kind) {
    case "relu": return z > 0 ? 1 : 0;
    case "leaky": return z > 0 ? 1 : 0.05;
    case "sigmoid": return a * (1 - a);
    case "tanh": return 1 - a * a;
  }
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Forward pass: as camadas ocultas usam a ativação escolhida; a saída usa Sigmoid (probabilidade). */
export function forward(net: Network, x: number[]): ForwardTrace {
  const z: number[][] = [x.slice()];
  const a: number[][] = [x.slice()];
  for (let layer = 0; layer < net.weights.length; layer++) {
    const last = layer === net.weights.length - 1;
    const zs = net.weights[layer].map((row, j) => row.reduce((sum, w, i) => sum + w * a[layer][i], net.biases[layer][j]));
    z.push(zs);
    a.push(zs.map((value) => (last ? sigmoid(value) : activate(net.activation, value))));
  }
  return { z, a };
}

export function predict(net: Network, x: number[]) {
  const trace = forward(net, x);
  return trace.a[trace.a.length - 1][0];
}

/** Entropia cruzada binária: a versão de duas classes da entropia cruzada da Aula 3, p. 11. */
export function loss(net: Network, data: Sample[]) {
  let total = 0;
  for (const sample of data) {
    const p = Math.min(1 - 1e-7, Math.max(1e-7, predict(net, sample.x)));
    total += -(sample.y * Math.log(p) + (1 - sample.y) * Math.log(1 - p));
  }
  return total / data.length;
}

export function accuracy(net: Network, data: Sample[]) {
  return data.filter((sample) => (predict(net, sample.x) >= 0.5 ? 1 : 0) === sample.y).length / data.length;
}

export type Gradients = { weights: number[][][]; biases: number[][] };

/** Backward pass: começa na perda e aplica a regra da cadeia de trás para frente (Aula 3, p. 15). */
export function gradients(net: Network, batch: Sample[]): Gradients {
  const gw = net.weights.map((layer) => layer.map((row) => row.map(() => 0)));
  const gb = net.biases.map((layer) => layer.map(() => 0));
  for (const sample of batch) {
    const { z, a } = forward(net, sample.x);
    const L = net.weights.length;
    // saída sigmoid + entropia cruzada: o erro na saída é simplesmente (previsão − alvo)
    let delta = [a[L][0] - sample.y];
    for (let layer = L - 1; layer >= 0; layer--) {
      for (let j = 0; j < delta.length; j++) {
        gb[layer][j] += delta[j];
        for (let i = 0; i < a[layer].length; i++) gw[layer][j][i] += delta[j] * a[layer][i];
      }
      if (layer === 0) break;
      const previous: number[] = [];
      for (let i = 0; i < a[layer].length; i++) {
        let sum = 0;
        for (let j = 0; j < delta.length; j++) sum += net.weights[layer][j][i] * delta[j];
        previous.push(sum * derivative(net.activation, z[layer][i], a[layer][i]));
      }
      delta = previous;
    }
  }
  const n = batch.length;
  return { weights: gw.map((layer) => layer.map((row) => row.map((value) => value / n))), biases: gb.map((layer) => layer.map((value) => value / n)) };
}

/** Atualização do gradiente descendente: θ ← θ − α∇J(θ) (Aula 3, p. 12). */
export function applyGradients(net: Network, grads: Gradients, rate: number): Network {
  return {
    ...net,
    weights: net.weights.map((layer, l) => layer.map((row, j) => row.map((w, i) => w - rate * grads.weights[l][j][i]))),
    biases: net.biases.map((layer, l) => layer.map((b, j) => b - rate * grads.biases[l][j])),
  };
}

export function batches(data: Sample[], size: number, seed: number): Sample[][] {
  const random = rng(seed);
  const order = data.map((sample) => ({ sample, key: random() })).sort((p, q) => p.key - q.key).map((item) => item.sample);
  const result: Sample[][] = [];
  for (let start = 0; start < order.length; start += size) result.push(order.slice(start, start + size));
  return result;
}

/** Uma época inteira de mini-batch SGD (Aula 3, p. 13). */
export function trainEpoch(net: Network, data: Sample[], rate: number, batchSize: number, seed: number): Network {
  let current = net;
  for (const batch of batches(data, batchSize, seed)) current = applyGradients(current, gradients(current, batch), rate);
  return current;
}

export type Dataset = "xor" | "circle" | "diagonal";

export function makeDataset(kind: Dataset, count = 120, seed = 3): Sample[] {
  const random = rng(seed);
  const samples: Sample[] = [];
  for (let index = 0; index < count; index++) {
    const x1 = random() * 2 - 1;
    const x2 = random() * 2 - 1;
    let y: 0 | 1;
    if (kind === "xor") {
      // afasta os pontos dos eixos para os quatro grupos ficarem nítidos
      const p = [x1 + Math.sign(x1) * 0.15, x2 + Math.sign(x2) * 0.15].map((value) => Math.max(-1, Math.min(1, value))) as [number, number];
      y = p[0] * p[1] > 0 ? 0 : 1;
      samples.push({ x: p, y });
      continue;
    }
    if (kind === "circle") y = Math.hypot(x1, x2) < 0.55 ? 1 : 0;
    else y = x1 + x2 > 0.1 ? 1 : 0;
    samples.push({ x: [x1, x2], y });
  }
  return samples;
}
