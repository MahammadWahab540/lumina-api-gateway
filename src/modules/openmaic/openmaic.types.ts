export interface WarmupClassroomRequest {
  // New fields
  courseId?: string;
  lessonId?: string;
  userId?: string;

  // Deprecated old fields (kept for backward compatibility)
  /** @deprecated */
  stageId?: string;
  /** @deprecated */
  topic?: string;
  /** @deprecated */
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
