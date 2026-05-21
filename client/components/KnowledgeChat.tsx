'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Eraser,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Send,
  Trash2,
} from 'lucide-react';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import { createChatCompletion, type ChatModel, type ChatTurn } from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';
import {
  clearAllChatSessions,
  createEmptySession,
  createMessage,
  deriveSessionTitle,
  loadChatWorkspace,
  pickActiveSessionId,
  pollChatWorkspace,
  saveChatWorkspace,
  type ChatSession,
  type ChatStorageMode,
  type ChatWorkspacePayload,
} from '@/lib/chat-storage';

const MODEL_OPTIONS: { value: ChatModel; label: string }[] = [
  { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
  { value: 'MiniMax-M2.7-highspeed', label: 'M2.7 极速' },
  { value: 'MiniMax-M2.5', label: 'MiniMax-M2.5' },
  { value: 'MiniMax-M2.5-highspeed', label: 'M2.5 极速' },
];

const SYSTEM_PROMPT =
  '你是一个专业的知识问答助手。请用清晰、准确的中文回答用户问题；若不确定请如实说明，不要编造事实。';

const CHAT_POLL_MS = 2000;

function toApiMessages(session: ChatSession): ChatTurn[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];
}

export function KnowledgeChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState('');
  const [input, setInput] = useState('');
  const [model, setModel] = useState<ChatModel>('MiniMax-M2.7');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncMode, setSyncMode] = useState<ChatStorageMode>('local');
  const [serverRevision, setServerRevision] = useState('');
  const [syncError, setSyncError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const revisionRef = useRef('');
  const activeIdRef = useRef('');
  const modelRef = useRef<ChatModel>('MiniMax-M2.7');
  const savingRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<ChatWorkspacePayload | null>(null);
  const saveFailStreakRef = useRef(0);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    revisionRef.current = serverRevision;
  }, [serverRevision]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshot = await loadChatWorkspace();
      if (cancelled) return;
      setSyncMode(snapshot.mode);
      setServerRevision(snapshot.revision);
      revisionRef.current = snapshot.revision;
      setModel(snapshot.chatModel);
      modelRef.current = snapshot.chatModel;
      if (snapshot.sessions.length === 0) {
        const first = createEmptySession();
        setSessions([first]);
        setActiveId(first.id);
        activeIdRef.current = first.id;
        const saved = await saveChatWorkspace({
          sessions: [first],
          activeSessionId: first.id,
          chatModel: snapshot.chatModel,
        });
        if (!cancelled) {
          setSyncMode(saved.mode);
          setServerRevision(saved.revision);
          revisionRef.current = saved.revision;
        }
      } else {
        setSessions(snapshot.sessions);
        const active = pickActiveSessionId(snapshot.activeSessionId, snapshot.sessions);
        setActiveId(active);
        activeIdRef.current = active;
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || syncMode !== 'server') return;
    const timer = window.setInterval(() => {
      if (loading || savingRef.current) return;
      void (async () => {
        const remote = await pollChatWorkspace(revisionRef.current);
        if (!remote) return;
        revisionRef.current = remote.revision;
        setServerRevision(remote.revision);
        setSessions(remote.sessions);
        const active = pickActiveSessionId(remote.activeSessionId, remote.sessions);
        setActiveId(active);
        activeIdRef.current = active;
        setModel(remote.chatModel);
        modelRef.current = remote.chatModel;
        setSyncMode('server');
        saveFailStreakRef.current = 0;
        setSyncError('');
      })();
    }, CHAT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hydrated, syncMode, loading]);

  const flushPersist = useCallback(async () => {
    const next = pendingPersistRef.current;
    if (!next) return;
    pendingPersistRef.current = null;
    savingRef.current = true;
    try {
      let saved = await saveChatWorkspace(next);
      if (saved.mode !== 'server') {
        await new Promise((r) => setTimeout(r, 400));
        saved = await saveChatWorkspace(next);
      }
      setSyncMode(saved.mode);
      setServerRevision(saved.revision);
      revisionRef.current = saved.revision;
      if (saved.mode === 'server') {
        saveFailStreakRef.current = 0;
        setSyncError('');
      } else {
        saveFailStreakRef.current += 1;
        if (saveFailStreakRef.current >= 2) {
          setSyncError(
            '暂时无法同步到 API（请确认已运行 start.ps1 / 8787 端口）。会话已缓存在本机，恢复连接后会自动重试。',
          );
        }
      }
    } catch (err) {
      saveFailStreakRef.current += 1;
      if (saveFailStreakRef.current >= 2) {
        setSyncError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  const scheduleWorkspacePersist = useCallback(
    (
      nextSessions: ChatSession[],
      overrides?: Partial<Pick<ChatWorkspacePayload, 'activeSessionId' | 'chatModel'>>,
    ) => {
      setSessions(nextSessions);
      pendingPersistRef.current = {
        sessions: nextSessions,
        activeSessionId: pickActiveSessionId(
          overrides?.activeSessionId ?? activeIdRef.current,
          nextSessions,
        ),
        chatModel: overrides?.chatModel ?? modelRef.current,
      };
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void flushPersist();
      }, 400);
    },
    [flushPersist],
  );

  const selectSession = useCallback(
    (id: string) => {
      setActiveId(id);
      activeIdRef.current = id;
      setError('');
      scheduleWorkspacePersist(sessions, { activeSessionId: id });
    },
    [sessions, scheduleWorkspacePersist],
  );

  useEffect(
    () => () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    },
    [],
  );

  const patchSession = useCallback(
    (id: string, updater: (s: ChatSession) => ChatSession) => {
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === id ? updater(s) : s));
        scheduleWorkspacePersist(next);
        return next;
      });
    },
    [scheduleWorkspacePersist],
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [activeSession?.messages, loading]);

  const newSession = () => {
    const session = createEmptySession();
    const next = [session, ...sessions];
    setActiveId(session.id);
    activeIdRef.current = session.id;
    scheduleWorkspacePersist(next, { activeSessionId: session.id });
    setInput('');
    setError('');
    inputRef.current?.focus();
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    if (next.length === 0) {
      const session = createEmptySession();
      setActiveId(session.id);
      activeIdRef.current = session.id;
      scheduleWorkspacePersist([session], { activeSessionId: session.id });
    } else {
      const nextActive =
        activeId === id ? pickActiveSessionId(next[0].id, next) : activeId;
      setActiveId(nextActive);
      activeIdRef.current = nextActive;
      scheduleWorkspacePersist(next, { activeSessionId: nextActive });
    }
    setError('');
  };

  const clearAllHistory = async () => {
    if (clearing) return;
    const hasContent = sessions.some((s) => s.messages.length > 0);
    if (hasContent) {
      const ok = window.confirm(
        '确定清理全部知识问答历史？所有浏览器/设备上的会话记录都会被删除，且无法恢复。',
      );
      if (!ok) return;
    }
    setClearing(true);
    setError('');
    try {
      const cleared = await clearAllChatSessions();
      setSyncMode(cleared.mode);
      setServerRevision(cleared.revision);
      revisionRef.current = cleared.revision;
      const session = createEmptySession();
      setActiveId(session.id);
      activeIdRef.current = session.id;
      await saveChatWorkspace({
        sessions: [session],
        activeSessionId: session.id,
        chatModel: modelRef.current,
      });
      setSessions([session]);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !activeSession || loading) return;

    setError('');
    setInput('');
    setLoading(true);

    const userMsg = createMessage('user', text);
    const withUser: ChatSession = {
      ...activeSession,
      messages: [...activeSession.messages, userMsg],
      title:
        activeSession.messages.length === 0
          ? deriveSessionTitle(text)
          : activeSession.title,
      updatedAt: Date.now(),
    };
    patchSession(activeSession.id, () => withUser);

    try {
      const reply = await createChatCompletion({
        model,
        messages: toApiMessages(withUser),
      });
      const assistantMsg = createMessage('assistant', reply);
      patchSession(activeSession.id, (s) => ({
        ...s,
        messages: [...withUser.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      patchSession(activeSession.id, (s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== userMsg.id),
        updatedAt: Date.now(),
      }));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (!hydrated) {
    return (
      <div className="flex h-[min(70vh,720px)] items-center justify-center rounded-lg border border-border bg-card">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="flex h-[min(75vh,760px)] overflow-hidden rounded-lg border border-border bg-card shadow-panel">
      {/* 会话列表 */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-muted/30">
        <div className="space-y-2 border-b border-border p-3">
          <button
            type="button"
            onClick={newSession}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <MessageSquarePlus size={16} />
            新对话
          </button>
          <button
            type="button"
            onClick={() => void clearAllHistory()}
            disabled={clearing || loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {clearing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Eraser size={16} />
            )}
            清理全部
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            return (
              <div
                key={s.id}
                className={`group mb-1 flex items-center gap-1 rounded-lg transition ${
                  isActive ? 'bg-primary/15' : 'hover:bg-muted'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectSession(s.id)}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                >
                  <span
                    className={`block truncate text-sm ${
                      isActive ? 'font-semibold text-primary' : 'text-foreground'
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {s.messages.length} 条消息
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteSession(s.id)}
                  className="mr-1 shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  aria-label="删除会话"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* 对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-primary" />
            <h2 className="text-sm font-semibold">{activeSession?.title ?? '知识问答'}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
          <span
            className={`text-[10px] ${
              syncMode === 'server'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
            title={
              syncMode === 'server'
                ? '已连接 API，其他浏览器约 2 秒内同步'
                : '请启动 API 服务（8787）或检查 NEXT_PUBLIC_API_BASE_URL'
            }
          >
            {syncMode === 'server' ? '● 服务器同步' : '○ 仅本机'}
          </span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            模型
            <select
              value={model}
              onChange={(e) => {
                const next = e.target.value as ChatModel;
                setModel(next);
                modelRef.current = next;
                scheduleWorkspacePersist(sessions, { chatModel: next });
              }}
              disabled={loading}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          </div>
        </div>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {activeSession?.messages.length === 0 && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <MessageSquare size={36} className="opacity-40" />
              <p className="text-sm">开始提问吧，本会话会记住上下文</p>
            </div>
          )}
          {activeSession?.messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-muted/50 text-foreground'
                }`}
              >
                <ChatMessageContent
                  content={m.content}
                  variant={m.role === 'user' ? 'user' : 'assistant'}
                />
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                思考中…
              </div>
            </div>
          )}
        </div>

        {(syncError || error) && (
          <div className="mx-4 mb-2 space-y-2">
            {syncError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{syncError}</span>
              </div>
            )}
            <MiniMaxBillingAlert error={error} featureLabel="知识问答" />
            {error && !buildMiniMaxBillingAlert(error) && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-border p-4">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
              rows={2}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              className="min-h-[52px] flex-1 resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              aria-label="发送"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            {syncMode === 'server'
              ? '会话、左侧选中项与模型均保存在 API，多浏览器约 2 秒同步；重新打开会恢复上次状态。'
              : '未连接 API：请运行 start.ps1。仅本机浏览器可看到记录。'}
          </p>
        </div>
      </div>
    </div>
  );
}
