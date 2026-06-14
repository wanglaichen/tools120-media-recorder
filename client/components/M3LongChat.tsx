'use client';

import { useState } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import { createM3LongAnalysis } from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';

const DOC_EXAMPLE = `【示例：产品更新说明节选】
1. 本版本新增 MiniMax M3 多模态理解与音乐生成。
2. 文本、图片、语音、音乐共享 Plus 档额度。
3. 支持约 600 万+ M3 tokens / 月与 1M 长上下文。`;

const QUESTION_EXAMPLES = [
  '用三条要点总结全文。',
  '列出文中提到的功能与限制。',
  '把内容改写成面向用户的公告（200 字内）。',
];

export function M3LongChat() {
  const [document, setDocument] = useState('');
  const [question, setQuestion] = useState(QUESTION_EXAMPLES[0]);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runAnalyze = async () => {
    setError('');
    setAnswer('');
    setLoading(true);
    try {
      const reply = await createM3LongAnalysis({ document, question, model: 'MiniMax-M3' });
      setAnswer(reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.55fr]">
      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileText size={20} className="text-primary" />
          <h2 className="text-base font-semibold">长文分析（M3 · 1M 上下文）</h2>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          粘贴合同、论文、日志等长文本，由 M3 做摘要、问答或改写。Plus 档支持超长上下文。
        </p>

        <div className="grid gap-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">待分析全文</label>
              <button
                type="button"
                disabled={loading}
                onClick={() => setDocument(DOC_EXAMPLE)}
                className="text-xs text-primary hover:underline"
              >
                填入示例
              </button>
            </div>
            <textarea
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              disabled={loading}
              rows={12}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed"
              placeholder="粘贴 Markdown、PDF 复制文本、代码仓库说明等…"
            />
            <p className="mt-1 text-xs text-muted-foreground">{document.length.toLocaleString()} 字符</p>
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap gap-1">
              <label className="mr-auto text-sm font-medium">分析问题</label>
              {QUESTION_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={loading}
                  onClick={() => setQuestion(ex)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  示例
                </button>
              ))}
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={loading}
              rows={2}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <button
            type="button"
            onClick={() => void runAnalyze()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                M3 分析中…
              </>
            ) : (
              '开始分析'
            )}
          </button>

          {error && (
            <>
              <MiniMaxBillingAlert error={error} featureLabel="长文分析" feature="chat" />
              {!buildMiniMaxBillingAlert(error, 'chat') && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-border bg-card p-4 shadow-panel">
        <h3 className="mb-3 text-sm font-semibold">分析结果</h3>
        {answer ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</div>
        ) : (
          <p className="text-sm text-muted-foreground">结果将显示在这里。</p>
        )}
      </aside>
    </div>
  );
}
