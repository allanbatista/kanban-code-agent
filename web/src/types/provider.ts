export interface Provider {
  id: string;
  name: string;
  status: 'connected' | 'not_configured' | 'error';
  defaultModel: string;
  apiKeyConfigured: boolean;
}
