export interface CreateVoiceSessionRequest {
  projectContextId: string;
  voiceSessionId: string;
  modelProvider?: 'gemini' | 'openai' | 'dashscope';
  sessionConfig?: {
    maxDurationSeconds?: number;
    language?: string;
  };
}

export interface CreateAssignmentVoiceSessionRequest {
  assignmentId: string;
  voiceSessionId?: string;
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
  ws_endpoint?: string;
}

export interface VoiceDiscoveryHealth {
  healthy: boolean;
  status: string;
  providers?: Record<string, boolean>;
  pool?: Record<string, unknown>;
}
