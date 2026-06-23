import type { ChatMessage } from '@/types/task';

export const MOCK_CHAT_MESSAGES: ChatMessage[] = [
  { ts: new Date(Date.now() - 300000).toISOString(), role: 'user', type: 'text', text: 'Implementar login OAuth com GitHub na aplicação React. Preciso que o usuário possa autenticar usando sua conta do GitHub e receber um token JWT.' },
  { ts: new Date(Date.now() - 250000).toISOString(), role: 'assistant', type: 'text', text: 'Vou implementar o fluxo OAuth completo. Primeiro, vamos configurar o cliente OAuth no GitHub, depois criar o componente de login e o hook de autenticação.' },
  { ts: new Date(Date.now() - 240000).toISOString(), role: 'assistant', type: 'artifact', text: 'Criado o arquivo de configuração OAuth.', artifacts: [{ description: 'OAuth Config', file_type: 'typescript', path: '/artifacts/oauth-config.ts', sizeBytes: 1200 }] },
  { ts: new Date(Date.now() - 200000).toISOString(), role: 'user', type: 'text', text: 'Preciso também de suporte a refresh token e tratamento de erros de expiração.' },
  { ts: new Date(Date.now() - 180000).toISOString(), role: 'assistant', type: 'text', text: 'Adicionando refresh token interceptor e tratamento de erros 401 automático no axios.' },
  { ts: new Date(Date.now() - 150000).toISOString(), role: 'event', type: 'event', text: 'Fluxo OAuth implementado. Aguardando code review.' },
];
