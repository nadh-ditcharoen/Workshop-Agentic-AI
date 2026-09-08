import type { ChatMessage, ChatTurnResult, McpTool, ToolCaller, ToolTraceEntry } from '../types';

export async function runOpenAiCompatConversation(baseUrl: string, apiKey: string, model: string, systemPrompt: string, history: ChatMessage[], tools: McpTool[], callTool?: ToolCaller): Promise<ChatTurnResult> {
  if (!baseUrl.trim()) return { reply: 'ยังไม่ได้ตั้งค่า base URL ของ OpenAI-compatible gateway ในระบบ', toolTrace: [] };
  if (!apiKey.trim()) return { reply: 'ยังไม่ได้ตั้งค่า API key ของ provider นี้ในระบบ จึงยังเรียก AI ไม่ได้', toolTrace: [] };
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  const trace: ToolTraceEntry[] = [];
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  for (let round = 0; round < 4; round += 1) {
    const body: Record<string, unknown> = { model, messages };
    if (tools.length) { body.tools = tools.map((tool) => ({ type: 'function', function: { name: `${tool.serverId}__${tool.name}`, description: tool.description, parameters: tool.inputSchema } })); body.tool_choice = 'auto'; }
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
    if (!response.ok) return { reply: `OpenAI-compatible gateway ตอบกลับผิดพลาด (${response.status})`, toolTrace: trace };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const message = data.choices?.[0]?.message;
    if (!message) return { reply: 'AI ไม่ได้ส่งข้อความตอบกลับ', toolTrace: trace };
    if (!message.tool_calls?.length) return { reply: message.content?.trim() || 'โมเดลไม่ได้ส่งข้อความตอบกลับ', toolTrace: trace };
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      let args: Record<string, unknown> = {}; try { args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>; } catch { /* leave empty */ }
      const entry: ToolTraceEntry = { name: call.function.name, arguments: args };
      try { entry.result = callTool ? await callTool(call.function.name, args) : { error: 'ยังไม่มี tool ให้เรียกใช้' }; } catch (error) { entry.error = error instanceof Error ? error.message : String(error); entry.result = { error: entry.error }; }
      trace.push(entry); messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(entry.result) });
    }
  }
  return { reply: 'การเรียกใช้เครื่องมือเกินจำนวนรอบที่กำหนด', toolTrace: trace };
}