import type { Env } from '../env';
import { errorJson, json } from '../lib/http';
import { runGeminiConversation } from './providers/gemini';
import { runOpenAiCompatConversation } from './providers/openai-compat';
import type { ChatMessage, ChatProvider, ChatTurnResult, McpTool } from './types';

type ChatRequest = { message: string; history?: ChatMessage[]; provider?: string; model?: string };

export function resolveProvider(value: string | undefined, env: Env): ChatProvider {
  const candidate = value || env.DEFAULT_CHAT_PROVIDER || 'gemini';
  return candidate === 'openai' || candidate === 'openai-compat' ? candidate : 'gemini';
}
export function defaultModelFor(provider: ChatProvider, env: Env): string {
  return provider === 'gemini' ? env.GEMINI_MODEL || 'gemini-flash-latest' : provider === 'openai' ? env.OPENAI_MODEL || 'gpt-4o-mini' : env.OPENAI_COMPAT_MODEL || 'gpt-4o-mini';
}
export function buildSystemPrompt(): string { return 'คุณคือผู้ช่วย AI ภาษาไทยที่สุภาพและ helpful ตอบให้ชัดเจน กระชับ และตรงคำถาม หากไม่แน่ใจให้บอกตามตรง'; }
function resolveApiKey(provider: ChatProvider, env: Env): string { return provider === 'gemini' ? env.GEMINI_API_KEY || '' : provider === 'openai' ? env.OPENAI_API_KEY || '' : env.OPENAI_COMPAT_API_KEY || ''; }
function resolveBaseUrl(provider: ChatProvider, env: Env): string { return provider === 'openai' ? 'https://api.openai.com/v1' : env.OPENAI_COMPAT_BASE_URL || ''; }
function resolveTools(): McpTool[] { return []; }

export async function handleChatRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return errorJson('กรุณาใช้ POST /api/chat', 405);
  let payload: ChatRequest;
  try { payload = await request.json() as ChatRequest; } catch { return errorJson('ข้อมูล JSON ไม่ถูกต้อง'); }
  if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) return errorJson('กรุณาระบุ message ที่ไม่ว่าง');
  const provider = resolveProvider(payload.provider, env);
  const model = payload.model?.trim() || defaultModelFor(provider, env);
  const history = Array.isArray(payload.history) ? payload.history.filter((m): m is ChatMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-40) : [];
  const result = await runChatTurn({ provider, model, message: payload.message, history, env });
  return json({ reply: result.reply, provider, model, toolTrace: result.toolTrace });
}

export async function runChatTurn(input: { provider: ChatProvider; model: string; message: string; history?: ChatMessage[]; env: Env }): Promise<ChatTurnResult> {
  const history = [...(input.history || []), { role: 'user' as const, content: input.message }];
  const tools = resolveTools();
  if (input.provider === 'gemini') return runGeminiConversation(resolveApiKey(input.provider, input.env), input.model, buildSystemPrompt(), history, tools);
  return runOpenAiCompatConversation(resolveBaseUrl(input.provider, input.env), resolveApiKey(input.provider, input.env), input.model, buildSystemPrompt(), history, tools);
}