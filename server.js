const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => res.json({ status: 'OK' }));

app.post('/api/claude', async (req, res) => {
  try {
    const { prompt, agentId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const maxTokens = agentId === 'synopsis' ? 4000 
                    : (agentId === 'synergy' || agentId === 'platform') ? 3500 : 1500;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',  // All Opus
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json({ text: message.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(process.env.PORT || 3000);
