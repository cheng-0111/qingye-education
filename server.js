import { createServer } from 'node:http';

const SYSTEM_PROMPT = `你是“青野智教”的AI学习伙伴，服务于乡村小学和初中学生。
请始终使用友善、简洁、符合学生年龄的中文回答，并遵循以下规则：
1. 不直接替学生完成作业，优先通过提问、提示和相似例子引导学生思考。
2. 回答分为“先想一想”“关键提示”“你来试试”三个简短部分。
3. 不确定时明确说明，不编造事实；危险实验、医疗、法律或人身安全问题应提醒学生向老师或监护人求助。
4. 不索取真实姓名、住址、电话、学校班级等个人隐私。
5. 优先围绕人工智能、芯片、电路、算法、机器人、物理、量子和节水八门科普课程答疑。
6. 即使学生要求最终答案，也先提供思路并鼓励其自己完成。`;

const allowedOrigin = 'https://cheng-0111.github.io';
const requests = new Map();

function headers(origin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  };
}

function send(response, status, data, origin = '') {
  response.writeHead(status, headers(origin));
  response.end(JSON.stringify(data));
}

function rateLimited(request) {
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = requests.get(ip);
  if (!record || now - record.startedAt > 10 * 60 * 1000) {
    requests.set(ip, { count: 1, startedAt: now });
    return false;
  }
  record.count += 1;
  return record.count > 20;
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error('body_too_large');
  }
  return JSON.parse(body || '{}');
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  const url = new URL(request.url || '/', 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/health') {
    return send(response, 200, { ok: true, service: 'qingye-ai' }, origin);
  }
  if (request.method === 'OPTIONS') {
    if (origin !== allowedOrigin) return send(response, 403, { error: '请求来源未授权。' }, origin);
    response.writeHead(204, headers(origin));
    return response.end();
  }
  if (request.method !== 'POST' || url.pathname !== '/api/chat') {
    return send(response, 404, { error: 'Not found' }, origin);
  }
  if (origin !== allowedOrigin) return send(response, 403, { error: '请求来源未授权。' }, origin);
  if (!process.env.DEEPSEEK_API_KEY) return send(response, 503, { error: 'AI服务尚未配置。' }, origin);
  if (rateLimited(request)) return send(response, 429, { error: '提问太频繁，请十分钟后再试。' }, origin);

  try {
    const body = await readJson(request);
    const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    const messages = rawMessages
      .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
      .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 800) }))
      .filter((message) => message.content);
    if (!messages.length) return send(response, 400, { error: '请输入你想问的问题。' }, origin);

    const deepseek = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        thinking: { type: 'disabled' },
        max_tokens: 700,
        temperature: 0.5,
      }),
    });
    if (!deepseek.ok) {
      const message = deepseek.status === 401 ? 'AI服务配置无效。' : 'AI服务暂时繁忙，请稍后再试。';
      return send(response, deepseek.status, { error: message }, origin);
    }
    const data = await deepseek.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return send(response, 502, { error: 'AI暂时没有生成回答，请换一种问法。' }, origin);
    return send(response, 200, { content }, origin);
  } catch {
    return send(response, 500, { error: '网络连接出现问题，请稍后再试。' }, origin);
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '0.0.0.0', () => console.log(`Qingye AI listening on ${port}`));
