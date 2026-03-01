const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => res.json({ status: 'OK', agents: 10, models: 'sonnet-analysis+opus-synthesis', streaming: true }));

app.post('/api/claude', async (req, res) => {
  const { prompt, agentId } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Tier 1 Opus: 4000 output tokens/min, 30k input tokens/min.
  // Keep output low to avoid hitting ceiling. Dense prose = quality not length.
  // Opus for strategic synthesis; Sonnet for data-gathering
  const model =
    agentId === 'synopsis' ? 'claude-opus-4-20250514' :
    agentId === 'synergy'  ? 'claude-opus-4-20250514' :
                             'claude-sonnet-4-5-20250929';

  // Sonnet: 32k output/min — generous. Opus: 4k/min — keep under 4000
  const maxTokens =
    agentId === 'synopsis' ? 3500 :
    agentId === 'synergy'  ? 3500 :
                             4000;

  // Synopsis synthesises — 2 searches enough. All others get 5.
  const maxSearches = agentId === 'synopsis' ? 2 : 5;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    let fullText = '';
    const sources = [];

    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: maxSearches,
        }
      ],
      messages: [{ role: 'user', content: prompt }],
    });

    stream.on('text', (text) => {
      fullText += text;
      sendEvent('chunk', { text });
    });

    stream.on('message', (msg) => {
      for (const block of msg.content) {
        // Capture search queries from tool_use blocks
        if (block.type === 'tool_use' && block.name === 'web_search') {
          sendEvent('searching', { query: block.input?.query || '' });
        }
        // Extract URLs from web search results — try all known structures
        if (block.type === 'tool_result' && Array.isArray(block.content)) {
          for (const item of block.content) {
            // Structure 1: web_search_result type (Anthropic built-in tool)
            if (item.type === 'web_search_result' && item.url) {
              if (!sources.find(s => s.url === item.url)) {
                sources.push({ url: item.url, title: item.title || item.url, agent: agentId });
              }
            }
            // Structure 2: document type
            if (item.type === 'document' && item.document?.url) {
              const { url, title } = item.document;
              if (!sources.find(s => s.url === url)) {
                sources.push({ url, title: title || url, agent: agentId });
              }
            }
            // Structure 3: text type containing JSON with URL
            if (item.type === 'text' && item.text) {
              try {
                const parsed = JSON.parse(item.text);
                if (Array.isArray(parsed)) {
                  parsed.forEach(r => {
                    if (r.url && !sources.find(s => s.url === r.url)) {
                      sources.push({ url: r.url, title: r.title || r.url, agent: agentId });
                    }
                  });
                }
              } catch(e) { /* not JSON */ }
            }
          }
        }
      }
    });

    await stream.finalMessage();

    sendEvent('done', { text: fullText, sources });
    res.end();

  } catch (error) {
    console.error(`Agent ${agentId} error:`, error.message);
    sendEvent('error', { message: error.message });
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AdvisorSprint — Opus 4 + web search + streaming, port ${PORT}`);
});
