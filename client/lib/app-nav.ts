import type { LucideIcon } from 'lucide-react';
import {
  AudioWaveform,
  Eye,
  FileText,
  ImageIcon,
  Languages,
  MessageSquare,
  Mic,
  Music2,
  Video,
  Volume2,
} from 'lucide-react';

export type AppPageKey =
  | 'capture'
  | 'convert'
  | 'video'
  | 'image'
  | 'speech'
  | 'voice-clone'
  | 'music'
  | 'vision'
  | 'm3-long'
  | 'chat';

export type AppCategoryId = 'local' | 'minimax';

export type AppNavItem = {
  key: AppPageKey;
  label: string;
  detail: string;
  icon: LucideIcon;
  category: AppCategoryId;
};

export const APP_CATEGORY_TABS: {
  id: AppCategoryId;
  label: string;
  hint: string;
}[] = [
  { id: 'local', label: '本地工具', hint: '浏览器本地运行，无需 API Key' },
  {
    id: 'minimax',
    label: 'MiniMax',
    hint: 'Plus 档：视频 / 图片 / 语音 / 克隆 / 音乐 / M3 多模态 / 长文 / 问答',
  },
];

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    key: 'capture',
    label: '音频采集',
    detail: '麦克风录音',
    icon: Mic,
    category: 'local',
  },
  {
    key: 'convert',
    label: '音频转换',
    detail: 'Whisper 转写',
    icon: Languages,
    category: 'local',
  },
  {
    key: 'video',
    label: '文字转视频',
    detail: 'MiniMax 视频',
    icon: Video,
    category: 'minimax',
  },
  {
    key: 'image',
    label: '文字转图片',
    detail: 'MiniMax 图片',
    icon: ImageIcon,
    category: 'minimax',
  },
  {
    key: 'speech',
    label: '文字转语音',
    detail: 'MiniMax 语音',
    icon: Volume2,
    category: 'minimax',
  },
  {
    key: 'voice-clone',
    label: '声音克隆',
    detail: '录音定制音色',
    icon: AudioWaveform,
    category: 'minimax',
  },
  {
    key: 'music',
    label: '音乐生成',
    detail: '歌词 + 风格',
    icon: Music2,
    category: 'minimax',
  },
  {
    key: 'vision',
    label: '多模态理解',
    detail: 'M3 图 / 视频',
    icon: Eye,
    category: 'minimax',
  },
  {
    key: 'm3-long',
    label: '长文分析',
    detail: 'M3 · 1M 上下文',
    icon: FileText,
    category: 'minimax',
  },
  {
    key: 'chat',
    label: '知识问答',
    detail: '多会话对话',
    icon: MessageSquare,
    category: 'minimax',
  },
];

const LOCAL_KEYS = new Set<AppPageKey>(
  APP_NAV_ITEMS.filter((i) => i.category === 'local').map((i) => i.key),
);

export function getCategoryForPage(page: AppPageKey): AppCategoryId {
  return LOCAL_KEYS.has(page) ? 'local' : 'minimax';
}

export function getNavItemsByCategory(category: AppCategoryId): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => item.category === category);
}

export function getDefaultPageForCategory(category: AppCategoryId): AppPageKey {
  return getNavItemsByCategory(category)[0]?.key ?? 'capture';
}

export const APP_CATEGORY_STORAGE_KEY = 'tools120-app-category-v1';
export const APP_ACTIVE_PAGE_STORAGE_KEY = 'tools120-app-active-page-v1';

const PAGE_KEY_SET = new Set<AppPageKey>(APP_NAV_ITEMS.map((item) => item.key));

export function isAppPageKey(value: string | null | undefined): value is AppPageKey {
  return typeof value === 'string' && PAGE_KEY_SET.has(value as AppPageKey);
}

export function loadActivePage(): AppPageKey | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(APP_ACTIVE_PAGE_STORAGE_KEY);
  return isAppPageKey(raw) ? raw : null;
}

export function saveActivePage(page: AppPageKey): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(APP_ACTIVE_PAGE_STORAGE_KEY, page);
}

export function loadAppCategory(): AppCategoryId | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(APP_CATEGORY_STORAGE_KEY);
  if (raw === 'ai') return 'minimax';
  return raw === 'local' || raw === 'minimax' ? raw : null;
}

export function saveAppCategory(category: AppCategoryId): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(APP_CATEGORY_STORAGE_KEY, category);
}
