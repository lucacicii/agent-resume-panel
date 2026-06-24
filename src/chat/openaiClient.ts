import { ChatMessage } from "./types";

const NON_CHAT_MODEL_PATTERN =
  /(?:embed|embedding|tts|whisper|dall-e|moderation|realtime|audio|transcribe|vision-preview|inpaint|search|davinci|babbage)/i;

export interface OpenAIChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

export async function streamChatCompletion(options: OpenAIChatOptions): Promise<string> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: options.model,
    stream: true,
    messages: [
      { role: "system", content: options.systemPrompt },
      ...options.messages.map((message) => ({
        role: message.role,
        content: message.text
      }))
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: options.signal
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${body}`);
  }

  if (!response.body) {
    throw new Error("OpenAI response body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          fullText += delta;
          options.onDelta(fullText);
        }
      } catch {
        // Ignore malformed SSE chunks.
      }
    }
  }

  return fullText;
}

export async function fetchChatModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Models request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  const models = (payload.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id))
    .filter((id) => !NON_CHAT_MODEL_PATTERN.test(id))
    .sort((a, b) => a.localeCompare(b));

  if (!models.length) {
    throw new Error("Models endpoint returned no chat-compatible models.");
  }

  return models;
}