/** MiniMax 系统音色（摘自官方系统音色列表，按性别/语言分组） */

import { loadClonedVoices } from '@/lib/cloned-voices-storage';

export type SpeechVoiceGroup =
  | 'zh_female'
  | 'zh_male'
  | 'en_female'
  | 'en_male'
  | 'cloned';

export type SpeechVoiceOption = {
  value: string;
  label: string;
  group: SpeechVoiceGroup;
};

export const SPEECH_VOICE_GROUP_LABELS: Record<SpeechVoiceGroup, string> = {
  zh_female: '中文女声',
  zh_male: '中文男声',
  en_female: 'English · 女声',
  en_male: 'English · 男声',
  cloned: '我的克隆音色',
};

export const SPEECH_VOICE_OPTIONS: SpeechVoiceOption[] = [
  // 中文女声
  { value: 'female-tianmei', label: '甜美女性', group: 'zh_female' },
  { value: 'female-shaonv', label: '少女', group: 'zh_female' },
  { value: 'female-yujie', label: '御姐', group: 'zh_female' },
  { value: 'female-chengshu', label: '成熟女性', group: 'zh_female' },
  { value: 'Chinese (Mandarin)_Sweet_Lady', label: '甜美女声', group: 'zh_female' },
  { value: 'Chinese (Mandarin)_HK_Flight_Attendant', label: '港普空姐', group: 'zh_female' },
  { value: 'Chinese (Mandarin)_Warm_Girl', label: '温暖少女', group: 'zh_female' },
  { value: 'Chinese (Mandarin)_Mature_Woman', label: '傲娇御姐', group: 'zh_female' },

  // 中文男声（经典系列）
  { value: 'male-qn-qingse', label: '青涩青年', group: 'zh_male' },
  { value: 'male-qn-jingying', label: '精英青年', group: 'zh_male' },
  { value: 'male-qn-badao', label: '霸道青年', group: 'zh_male' },
  { value: 'male-qn-daxuesheng', label: '青年大学生', group: 'zh_male' },
  { value: 'junlang_nanyou', label: '俊朗男友', group: 'zh_male' },
  { value: 'badao_shaoye', label: '霸道少爷', group: 'zh_male' },
  { value: 'chunzhen_xuedi', label: '纯真学弟', group: 'zh_male' },
  { value: 'lengdan_xiongzhang', label: '冷淡学长', group: 'zh_male' },

  // 中文男声（系统音色）
  { value: 'Chinese (Mandarin)_Reliable_Executive', label: '沉稳高管', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Gentleman', label: '温润男声', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Male_Announcer', label: '播报男声', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Southern_Young_Man', label: '南方小哥', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Gentle_Youth', label: '温润青年', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Unrestrained_Young_Man', label: '不羁青年', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Radio_Host', label: '电台男主播', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Lyrical_Voice', label: '抒情男声', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Straightforward_Boy', label: '率真弟弟', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Sincere_Adult', label: '真诚青年', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Pure-hearted_Boy', label: '清澈邻家弟弟', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Humorous_Elder', label: '搞笑大爷', group: 'zh_male' },
  { value: 'Chinese (Mandarin)_Stubborn_Friend', label: '嘴硬竹马', group: 'zh_male' },

  // English 女声
  { value: 'English_Graceful_Lady', label: 'Graceful Lady', group: 'en_female' },
  { value: 'English_Whispering_girl', label: 'Whispering girl', group: 'en_female' },

  // English 男声
  { value: 'English_Trustworthy_Man', label: 'Trustworthy Man', group: 'en_male' },
  { value: 'English_Diligent_Man', label: 'Diligent Man', group: 'en_male' },
  { value: 'English_Gentle-voiced_man', label: 'Gentle-voiced man', group: 'en_male' },
  { value: 'English_Aussie_Bloke', label: 'Aussie Bloke', group: 'en_male' },
];

export const DEFAULT_SPEECH_VOICE_ID = 'female-tianmei';

const voiceLabelMap = new Map(SPEECH_VOICE_OPTIONS.map((o) => [o.value, o.label]));

export function speechVoiceLabel(voiceId: string): string {
  const cloned = loadClonedVoices().find((v) => v.voiceId === voiceId);
  if (cloned) return cloned.label;
  return voiceLabelMap.get(voiceId) ?? voiceId;
}

export function getClonedSpeechVoiceOptions(): SpeechVoiceOption[] {
  return loadClonedVoices().map((v) => ({
    value: v.voiceId,
    label: v.label,
    group: 'cloned' as const,
  }));
}

export function normalizeSpeechVoiceId(voiceId: string | undefined): string {
  if (voiceId && voiceLabelMap.has(voiceId)) return voiceId;
  if (voiceId && loadClonedVoices().some((v) => v.voiceId === voiceId)) return voiceId;
  return DEFAULT_SPEECH_VOICE_ID;
}

export const SPEECH_VOICE_GROUP_ORDER: SpeechVoiceGroup[] = [
  'cloned',
  'zh_female',
  'zh_male',
  'en_female',
  'en_male',
];
