export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  token_estimated?: boolean;
}

/**
 * Lightweight fallback when an upstream OpenAI-compatible service omits usage.
 * It deliberately labels results as estimates rather than claiming tokenizer parity.
 */
export function estimateTokens(text: string): number {
  if (!text.trim()) return 0;
  const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const remainingCharacters = [...text].length - chineseCharacters;
  return Math.max(1, Math.ceil(chineseCharacters / 1.5 + remainingCharacters / 4));
}

export function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    }).join('');
  }
  return '';
}

export function estimatePromptTokens(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  const text = messages.map((message) => {
    if (!message || typeof message !== 'object') return '';
    return messageContentToText((message as { content?: unknown }).content);
  }).join('\n');
  // Account for roles and the chat message framing in addition to visible text.
  return estimateTokens(text) + messages.length * 4 + 2;
}

export function usageWithFallback(
  usage: TokenUsage,
  promptTextTokens: number,
  completionText: string,
): TokenUsage {
  if (usage.total_tokens !== undefined || usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
    const prompt_tokens = usage.prompt_tokens ?? promptTextTokens;
    const completion_tokens = usage.completion_tokens ?? estimateTokens(completionText);
    return {
      prompt_tokens,
      completion_tokens,
      total_tokens: usage.total_tokens ?? prompt_tokens + completion_tokens,
      token_estimated: false,
    };
  }

  const completion_tokens = estimateTokens(completionText);
  return {
    prompt_tokens: promptTextTokens,
    completion_tokens,
    total_tokens: promptTextTokens + completion_tokens,
    token_estimated: true,
  };
}
