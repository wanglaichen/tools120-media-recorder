export type RecordingClip = {
  id: string;
  displayName: string;
  fileName: string;
  blob: Blob | null;
  url: string;
  duration: number;
  createdAt: number;
  size: number;
  type: string;
};