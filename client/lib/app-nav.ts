import type { LucideIcon } from 'lucide-react';
import {
  AudioWaveform,
  ImageIcon,
  Languages,
  MessageSquare,
  Mic,
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
    hint: '需 MiniMax API Key：视频 / 图片 / 语音 / 克隆 / 知识问答',
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
