const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || null;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => res.json({ status: 'OK', agents: 10, pdf: 'puppeteer-ready' }));

// ━━━ CLAUDE STREAMING ENDPOINT ━━━
app.post('/api/claude', async (req, res) => {
  const { prompt, agentId } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const model =
    agentId === 'synopsis' ? 'claude-opus-4-20250514' :
    agentId === 'synergy'  ? 'claude-opus-4-20250514' :
                             'claude-sonnet-4-5-20250929';

  const maxTokens = 8000;
  const maxSearches = agentId === 'synopsis' ? 2 : 5;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  const keepaliveInterval = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch(e) { clearInterval(keepaliveInterval); }
  }, 20000);

  try {
    let fullText = '';
    const sources = [];

    const stream = anthropic.messages.stream({
      model, max_tokens: maxTokens,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      messages: [{ role: 'user', content: prompt }],
    });

    stream.on('text', (text) => { fullText += text; sendEvent('chunk', { text }); });

    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_delta' && event.type !== 'ping') {
        console.log(`[${agentId}] streamEvent:`, event.type, event.content_block?.type || '');
      }
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use' && block?.name === 'web_search') sendEvent('searching', { query: '' });
        if (block?.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          for (const item of results) {
            const url = item.url || item.source || item.link;
            const title = item.title || item.name || url;
            if (url && !sources.find(s => s.url === url)) {
              sources.push({ url, title, agent: agentId });
              sendEvent('source', { url, title, agent: agentId });
            }
          }
        }
      }
    });

    stream.on('message', (msg) => {
      for (const block of msg.content) {
        if (block.type === 'server_tool_use' && block.name === 'web_search' && block.input?.query)
          sendEvent('searching', { query: block.input.query.slice(0, 40) });
        if (block.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          for (const item of results) {
            const url = item.url || item.source || item.link;
            const title = item.title || item.name || url;
            if (url && !sources.find(s => s.url === url)) sources.push({ url, title, agent: agentId });
          }
        }
      }
    });

    await stream.finalMessage();
    clearInterval(keepaliveInterval);
    sendEvent('done', { text: fullText });
    res.end();
  } catch (error) {
    clearInterval(keepaliveInterval);
    console.error(`Agent ${agentId} error:`, error.message);
    sendEvent('error', { message: error.message });
    res.end();
  }
});

// ━━━ PUPPETEER PDF ENDPOINT ━━━
app.post('/api/pdf', async (req, res) => {
  const { html, company, acquirer } = req.body;
  if (!html) return res.status(400).json({ error: 'Missing html' });
  console.log(`[PDF] Generating for ${company} — ${html.length} chars`);
  let browser;
  try {
    const { execSync } = require('child_process');
    let chromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!chromePath) {
      const candidates = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ];
      for (const p of candidates) {
        try { execSync(`test -x ${p}`); chromePath = p; break; } catch(e) {}
      }
    }
    if (!chromePath) {
      try {
        chromePath = execSync('which google-chrome-stable || which google-chrome || which chromium-browser || which chromium 2>/dev/null', {encoding:'utf8'}).trim().split('\n')[0];
      } catch(e) {}
    }
    if (!chromePath) throw new Error('No Chrome found. Set PUPPETEER_EXECUTABLE_PATH in Render environment.');
    console.log('[PDF] Chrome found at:', chromePath);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--font-render-hinting=none'],
      headless: true
    });
    const page = await browser.newPage();
    // Allow Google Fonts CDN in headless context
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for fonts + charts to render — more reliable than networkidle0
    await new Promise(r => setTimeout(r, 3500));
    await new Promise(r => setTimeout(r, 2500));
    const pdf = await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top:'0mm', right:'0mm', bottom:'0mm', left:'0mm' }
    });
    await browser.close();
    const filename = `${(company||'Report').replace(/\s+/g,'_')}_AdvisorSprint_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
    console.log(`[PDF] Done — ${pdf.length} bytes`);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('[PDF] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AdvisorSprint — port ${PORT}`);
  console.log(`AdvisorSprint — port ${PORT}`);
  if (CHROME_PATH) console.log('[PDF] Chrome path:', CHROME_PATH);
  else console.log('[PDF] Using puppeteer bundled Chromium');
});
