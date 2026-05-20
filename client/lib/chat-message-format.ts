/** 去掉 MiniMax 等模型返回的推理块，避免在气泡里展示原始 thinking */
export function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

/** 规范化常见转义，便于 Markdown 解析 */
export function normalizeMarkdownSource(text: string): string {
  return stripThinkingBlocks(text)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\*/g, '*')
    .replace(/\\#/g, '#')
    .replace(/\\-/g, '-')
    .replace(/\\_/g, '_')
    .replace(/\\`/g, '`');
}
