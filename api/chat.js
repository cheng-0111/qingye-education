const SYSTEM_PROMPT = `你是“青野智教”的AI学习伙伴，服务于乡村小学和初中学生。
请始终使用友善、简洁、符合学生年龄的中文回答，并遵循以下规则：
1. 不直接替学生完成作业，优先通过提问、提示和相似例子引导学生思考。
2. 回答分为“先想一想”“关键提示”“你来试试”三个简短部分。
3. 不确定时明确说明，不编造事实；危险实验、医疗、法律或人身安全问题应提醒学生向老师或监护人求助。
4. 不索取真实姓名、住址、电话、学校班级等个人隐私。
5. 优先围绕人工智能、芯片、电路、算法、机器人、物理、量子和节水八门科普课程答疑。
6. 即使学生要求最终答案，也先提供思路并鼓励其自己完成。`;

const ALLOWED_ORIGIN = 'https://cheng-0111.github.io';

function setCors(response, origin) {
  response.setHeader('Access-Control-Allow-Origin', origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Vary', 'Origin');
}

export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  setCors(response, origin);

  if (request.method === 'OPTIONS') {
    return response.status(origin === ALLOWED_ORIGIN ? 204 : 403).end();
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
  if (origin !== ALLOWED_ORIGIN) return response.status(403).json({ error: '请求来源未授权。' });
  if (!process.env.DEEPSEEK_API_KEY) return response.status(503).json({ error: 'AI服务尚未配置。' });

  try {
    const rawMessages = Array.isArray(request.body?.messages) ? request.body.messages.slice(-8) : [];
    const messages = rawMessages
      .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
      .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 800) }))
      .filter((message) => message.content);
    if (!messages.length) return response.status(400).json({ error: '请输入你想问的问题。' });

    const deepseek = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 700,
        temperature: 0.5,
      }),
    });

    if (!deepseek.ok) {
      const message = deepseek.status === 401 ? 'AI服务配置无效。' : 'AI服务暂时繁忙，请稍后再试。';
      return response.status(deepseek.status).json({ error: message });
    }
    const data = await deepseek.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return response.status(502).json({ error: 'AI暂时没有生成回答，请换一种问法。' });
    return response.status(200).json({ content });
  } catch {
    return response.status(500).json({ error: '网络连接出现问题，请稍后再试。' });
  }
}
