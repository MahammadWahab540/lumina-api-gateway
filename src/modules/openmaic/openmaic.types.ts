export interface WarmupClassroomRequest {
  stageId: string;
  topic: string;
  description?: string;
  language?: string;
  options?: Record<string, unknown>;
}

export interface WarmupClassroomResponse {
  status: 'ready' | 'warming' | 'failed';
  stageId: string;
  classroomId?: string;
  jobId?: string;
  embedUrl?: string;
  message?: string;
  lastGeneratedAt?: string;
}
