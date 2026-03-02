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
    agentId === 'synopsis' ? 8000 :
    agentId === 'synergy'  ? 8000 :
                             8000;  // Raise to max — truncation is unacceptable

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

    // Listen to ALL raw stream events to catch web search results
    // tool_result blocks with URLs appear in server_tool_result events
    stream.on('streamEvent', (event) => {
      // Log raw event types so we can see the structure in Render logs
      if (event.type !== 'content_block_delta' && event.type !== 'ping') {
        console.log(`[${agentId}] streamEvent:`, event.type,
          event.content_block?.type || '',
          event.delta?.type || '');
      }

      // Capture search queries from tool_use content blocks
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use' && block?.name === 'web_search') {
          sendEvent('searching', { query: '' }); // query comes via input_json_delta
        }
        // Extract URLs from web_search_tool_result — emit each as its own small SSE event
        if (block?.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          for (const item of results) {
            const url   = item.url   || item.source || item.link;
            const title = item.title || item.name   || url;
            if (url && !sources.find(s => s.url === url)) {
              sources.push({ url, title, agent: agentId });
              sendEvent('source', { url, title, agent: agentId }); // small event, no truncation risk
            }
          }
        }
      }

      // Capture completed tool input (search query)
      if (event.type === 'content_block_stop' && event.index !== undefined) {
        // Not needed for sources but useful for debug
      }
    });

    stream.on('message', (msg) => {
      for (const block of msg.content) {
        // Capture search query for status display
        if (block.type === 'server_tool_use' && block.name === 'web_search' && block.input?.query) {
          sendEvent('searching', { query: block.input.query.slice(0, 40) });
        }
        // Extract URLs — block type confirmed from Render logs as 'web_search_tool_result'
        if (block.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          for (const item of results) {
            const url   = item.url   || item.source || item.link;
            const title = item.title || item.name   || url;
            if (url && !sources.find(s => s.url === url)) {
              sources.push({ url, title, agent: agentId });
            }
          }
        }
      }
    });

    await stream.finalMessage();

    sendEvent('done', { text: fullText });
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
