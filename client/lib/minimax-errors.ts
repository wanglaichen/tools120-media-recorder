/** MiniMax 费用 / 额度类错误识别与友好提示 */

export type MiniMaxFeature = 'chat' | 'video' | 'image';

export type MiniMaxBillingKind = 'weekly_quota' | 'text_quota' | 'balance' | 'other';

export interface MiniMaxBillingAlert {
  kind: MiniMaxBillingKind;
  title: string;
  summary: string;
  tips: string[];
  raw?: string;
}

const CONSOLE_URL = 'https://platform.minimaxi.com/user-center/payment/token-plan';

function isVideoQuotaMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return /video|hailuo|海螺|视频|周额度/.test(lower + text);
}

function isTextUsageLimitMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('usage limit exceeded') ||
    lower.includes('weekly usage limit') ||
    text.includes('2056') ||
    /5[- ]?hour|5小时|滚动.*窗口/.test(lower + text)
  );
}

function isNonBillingError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('invalid') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('not found') ||
    lower.includes('model') ||
    lower.includes('rate limit') ||
    lower.includes('rpm') ||
    lower.includes('tpm')
  );
}

export function detectMiniMaxBillingIssue(
  text: string,
  feature: MiniMaxFeature = 'video',
): MiniMaxBillingKind | null {
  if (isNonBillingError(text) && !text.includes('余额') && !text.includes('balance')) {
    return null;
  }

  const lower = text.toLowerCase();

  if (
    lower.includes('insufficient balance') ||
    text.includes('账户余额不足') ||
    text.includes('余额不足') ||
    lower.includes('insufficient funds') ||
    lower.includes('not enough balance')
  ) {
    return 'balance';
  }

  if (isTextUsageLimitMessage(text)) {
    if (feature === 'video' || isVideoQuotaMessage(text)) {
      return 'weekly_quota';
    }
    if (feature === 'chat' || feature === 'image') {
      return 'text_quota';
    }
  }

  if (feature === 'video') {
    if (
      lower.includes('token plan') ||
      text.includes('视频周额度') ||
      text.includes('周额度不足') ||
      /\b0\/0\b/.test(text)
    ) {
      return 'weekly_quota';
    }
  }

  return null;
}

export function buildMiniMaxBillingAlert(
  error: unknown,
  feature: MiniMaxFeature = 'video',
): MiniMaxBillingAlert | null {
  const raw = error instanceof Error ? error.message : String(error);
  const kind = detectMiniMaxBillingIssue(raw, feature);
  if (!kind) return null;

  const resetMatch = raw.match(/resets at ([^)\s]+)/i);

  if (kind === 'text_quota') {
    return {
      kind,
      title: 'MiniMax 文本用量已达上限',
      summary:
        '当前 API Key 在 Token Plan 的「文本」滚动窗口（通常每 5 小时）内请求次数或 Token 已用尽；与视频周额度、账户余额是分开计费的。',
      tips: [
        '登录 MiniMax 控制台 → 用量/套餐，查看文本模型（M2.7 / M2.5 等）剩余额度',
        '使用「M2.7 极速」需套餐支持 MiniMax-M2.7-highspeed（High-Speed 档）',
        resetMatch
          ? `额度预计释放/重置：${resetMatch[1]}`
          : '若提示 usage limit exceeded（错误码 2056），需等待下一 5 小时窗口',
        `控制台：${CONSOLE_URL}`,
        `接口原始信息：${raw}`,
      ],
      raw,
    };
  }

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

  const actionLabel =
    feature === 'chat'
      ? '知识问答（文本对话）'
      : feature === 'image'
        ? '图片生成'
        : '视频生成';

  return {
    kind: 'balance',
    title: 'MiniMax 账户余额不足',
    summary: `当前账户余额不足以完成本次${actionLabel}，请先充值后再试。`,
    tips: [
      '登录 MiniMax 控制台检查余额与账单',
      `充值入口：${CONSOLE_URL}`,
      '确认 API Key 与充值账户一致',
    ],
    raw,
  };
}

export function formatErrorForDisplay(
  error: unknown,
  feature: MiniMaxFeature = 'video',
): string {
  const billing = buildMiniMaxBillingAlert(error, feature);
  if (billing) {
    return `${billing.title}。${billing.summary}`;
  }
  return error instanceof Error ? error.message : String(error);
}
