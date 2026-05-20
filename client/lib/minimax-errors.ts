/** MiniMax 费用 / 额度类错误识别与友好提示 */

export type MiniMaxBillingKind = 'weekly_quota' | 'balance' | 'other';

export interface MiniMaxBillingAlert {
  kind: MiniMaxBillingKind;
  title: string;
  summary: string;
  tips: string[];
  raw?: string;
}

const CONSOLE_URL = 'https://platform.minimaxi.com/user-center/payment/token-plan';

export function detectMiniMaxBillingIssue(text: string): MiniMaxBillingKind | null {
  const lower = text.toLowerCase();
  if (
    lower.includes('usage limit exceeded') ||
    lower.includes('weekly usage limit') ||
    lower.includes('token plan') ||
    text.includes('视频周额度') ||
    text.includes('周额度不足') ||
    /\b0\/0\b/.test(text)
  ) {
    return 'weekly_quota';
  }
  if (
    lower.includes('insufficient balance') ||
    text.includes('账户余额不足') ||
    text.includes('余额不足') ||
    lower.includes('insufficient funds') ||
    lower.includes('not enough balance')
  ) {
    return 'balance';
  }
  return null;
}

export function buildMiniMaxBillingAlert(error: unknown): MiniMaxBillingAlert | null {
  const raw = error instanceof Error ? error.message : String(error);
  const kind = detectMiniMaxBillingIssue(raw);
  if (!kind) return null;

  const resetMatch = raw.match(/resets at ([^)\s]+)/i);

  if (kind === 'weekly_quota') {
    return {
      kind,
      title: 'MiniMax 视频周额度不足',
      summary:
        '账户里可能仍有余额，但当前 API Key 对应的「视频生成」本周次数已用完或未开通（常见为 Token Plan 视频配额 0/0）。',
      tips: [
        '登录 MiniMax 控制台 → 用量/套餐，查看「海螺视频」或 Token Plan 的视频周额度',
        '如需继续使用：升级套餐、购买加量包，或等待周额度重置',
        resetMatch ? `周额度预计重置：${resetMatch[1]}` : '留意控制台中的额度重置时间',
        `控制台：${CONSOLE_URL}`,
      ],
      raw,
    };
  }

  return {
    kind: 'balance',
    title: 'MiniMax 账户余额不足',
    summary: '当前账户余额不足以完成本次视频生成，请先充值后再试。',
    tips: [
      '登录 MiniMax 控制台检查余额与账单',
      `充值入口：${CONSOLE_URL}`,
      '确认 API Key 与充值账户一致',
    ],
    raw,
  };
}

export function formatErrorForDisplay(error: unknown): string {
  const billing = buildMiniMaxBillingAlert(error);
  if (billing) {
    return `${billing.title}。${billing.summary}`;
  }
  return error instanceof Error ? error.message : String(error);
}
