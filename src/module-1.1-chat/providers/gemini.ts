import type { ChatMessage, ChatTurnResult, McpTool, ToolCaller, ToolTraceEntry } from '../types';
import { toGeminiSchema } from '../tool-schema';

type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown };

export async function runGeminiConversation(apiKey: string, model: string, systemPrompt: string, history: ChatMessage[], tools: McpTool[], callTool?: ToolCaller): Promise<ChatTurnResult> {
  if (!apiKey.trim()) return { reply: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ จึงยังเรียก Gemini ไม่ได้', toolTrace: [] };
  const contents: Array<{ role: string; parts: GeminiPart[] }> = history.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
  const trace: ToolTraceEntry[] = [];
  for (let round = 0; round < 4; round += 1) {
    const body: Record<string, unknown> = { systemInstruction: { parts: [{ text: systemPrompt }] }, contents };
    if (tools.length) body.tools = [{ functionDeclarations: tools.map((tool) => ({ name: `${tool.serverId}__${tool.name}`, description: tool.description, parameters: toGeminiSchema(tool.inputSchema) })) }];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) return { reply: `Gemini ตอบกลับผิดพลาด (${response.status})`, toolTrace: trace };
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((part) => part.functionCall).map((part) => part.functionCall!);
    if (!calls.length) return { reply: parts.map((part) => part.text ?? '').join('').trim() || 'โมเดลไม่ได้ส่งข้อความตอบกลับ', toolTrace: trace };
    contents.push({ role: 'model', parts });
    for (const call of calls) {
      const entry: ToolTraceEntry = { name: call.name, arguments: call.args ?? {} };
      try { entry.result = callTool ? await callTool(call.name, call.args ?? {}) : { error: 'ยังไม่มี tool ให้เรียกใช้' }; } catch (error) { entry.error = error instanceof Error ? error.message : String(error); entry.result = { error: entry.error }; }
      trace.push(entry);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: { result: entry.result } } }] });
    }
  }
  return { reply: 'การเรียกใช้เครื่องมือเกินจำนวนรอบที่กำหนด', toolTrace: trace };
}