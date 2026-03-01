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
        // Web search results appear as server_tool_result or web_search_result blocks
        if (block?.type === 'web_search_result' || block?.type === 'server_tool_result') {
          console.log(`[${agentId}] search result block:`, JSON.stringify(block).slice(0, 200));
          if (block?.url && !sources.find(s => s.url === block.url)) {
            sources.push({ url: block.url, title: block.title || block.url, agent: agentId });
          }
        }
      }

      // Capture completed tool input (search query)
      if (event.type === 'content_block_stop' && event.index !== undefined) {
        // Not needed for sources but useful for debug
      }
    });

    stream.on('message', (msg) => {
      // Log assistant message structure
      console.log(`[${agentId}] assistant message blocks:`, 
        msg.content.map(b => b.type + (b.name ? ':'+b.name : '')).join(', '));

      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'web_search' && block.input?.query) {
          sendEvent('searching', { query: block.input.query.slice(0, 40) });
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
