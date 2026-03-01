const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => res.json({ status: 'OK', agents: 10, search: true, streaming: true }));

app.post('/api/claude', async (req, res) => {
  const { prompt, agentId } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const maxTokens =
    agentId === 'synopsis'    ? 8000 :
    agentId === 'platform'    ? 6000 :
    agentId === 'intl'        ? 6000 :
    agentId === 'synergy'     ? 6000 :
    agentId === 'market'      ? 5000 :
    agentId === 'competitive' ? 5000 :
                                5000;

  // Use SSE so the connection stays alive during long web-search runs
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on Render

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    let fullText = '';
    const sources = [];

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-20250514',
      max_tokens: maxTokens,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: agentId === 'synopsis' ? 4 : 15,
        }
      ],
      messages: [{ role: 'user', content: prompt }],
    });

    // Stream text chunks as they arrive
    stream.on('text', (text) => {
      fullText += text;
      sendEvent('chunk', { text });
    });

    // Capture search events so frontend can show "searching..."
    stream.on('message', (msg) => {
      // Extract sources from tool_result blocks
      for (const block of msg.content) {
        if (block.type === 'tool_result' && Array.isArray(block.content)) {
          for (const item of block.content) {
            if (item.type === 'document' && item.document?.url) {
              const { url, title } = item.document;
              if (!sources.find(s => s.url === url)) {
                sources.push({ url, title: title || url, agent: agentId });
              }
            }
          }
        }
        // Notify frontend when a search is being run
        if (block.type === 'tool_use' && block.name === 'web_search') {
          sendEvent('searching', { query: block.input?.query || '' });
        }
      }
    });

    await stream.finalMessage();

    // Send completion event with full text and all sources
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
  console.log(`AdvisorSprint — streaming, Opus 4 + web search, port ${PORT}`);
});
