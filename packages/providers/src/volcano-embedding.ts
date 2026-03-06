/**
 * Volcano Engine (火山引擎) Embedding Client.
 *
 * Uses the doubao-embedding multimodal API:
 *   POST https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal
 *
 * Environment variables:
 *   VOLCANO_EMBEDDING_KEY  — API key (required)
 *   VOLCANO_EMBEDDING_MODEL — model name (default: doubao-embedding-vision-250615)
 */

export interface VolcanoEmbeddingOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

/** Multimodal endpoint returns a single embedding object (not an array) */
interface EmbeddingResponse {
  created: number;
  data: { embedding: number[] };
  model?: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class VolcanoEmbedding {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(options: VolcanoEmbeddingOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "doubao-embedding-vision-250615";
    this.baseURL =
      options.baseURL ?? "https://ark.cn-beijing.volces.com/api/v3";
  }

  /**
   * Embed one or more texts, returns one vector per text.
   * Compatible with the EmbedFn signature: (texts: string[]) => Promise<number[][]>
   */
  async embed(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedSingle(text)));
  }

  private async embedSingle(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseURL}/embeddings/multimodal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [{ type: "text", text }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Volcano Embedding API error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as EmbeddingResponse;
    return json.data.embedding;
  }
}
