import { buildChatCompletionsUrl, LlmConfig } from "./config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
  };
}

export async function chatCompletion(config: LlmConfig, messages: ChatMessage[], maxTokens = 1024): Promise<string> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(60_000)
  });

  let payload: ChatCompletionResponse;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new Error(`LLM request failed with status ${response.status}.`);
  }

  if (!response.ok) {
    const message = payload.error?.message || `LLM request failed with status ${response.status}.`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    if (choice?.finish_reason === "length" || choice?.message?.reasoning_content) {
      throw new Error(
        "LLM returned an empty response: the output token limit was reached before any text was produced (common with reasoning models). Increase max_tokens or disable thinking mode."
      );
    }
    throw new Error("LLM returned an empty response.");
  }

  return content;
}