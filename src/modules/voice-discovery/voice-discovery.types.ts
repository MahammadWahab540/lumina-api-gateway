export interface CreateVoiceSessionRequest {
  projectContextId: string;
  voiceSessionId: string;
  modelProvider?: 'gemini' | 'openai' | 'dashscope';
  sessionConfig?: {
    maxDurationSeconds?: number;
    language?: string;
  };
}

export interface VoiceSessionCreatedResponse {
  sessionId: string;
  agentscopeSessionId: string;
  wsEndpoint: string;
  status: 'initializing' | 'active';
  contextItemsLoaded: number;
}

export interface AgentScopeSessionStatus {
  session_id: string;
  status: string;
}
