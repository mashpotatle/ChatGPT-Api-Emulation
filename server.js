// server.js — A simple HTTP API that wraps the brain.
//
// POST /ask   { "prompt": "your question" }  → { "reply": "..." }
// GET  /ready                                 → { "ready": true/false }
//
// This replaces the Discord bot. Any app, script, or tool can now talk to
// the AI by making a plain HTTP request — no Discord SDK needed.

const http = require('http');
const brain = require('./brain/brain'); // was ./brain/brain — still correct

const PORT = process.env.PORT || 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Simple JSON HTTP server ----
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    // ---- Health check: is the brain ready? ----
    if (req.method === 'GET' && req.url === '/ready') {
        return res.end(JSON.stringify({ ready: brain.ready }));
    }

    // ---- Ask a question ----
    if (req.method === 'POST' && req.url === '/ask') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { prompt } = JSON.parse(body);

                if (!prompt || typeof prompt !== 'string') {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: 'prompt must be a non-empty string' }));
                }

                // Wait for brain to be ready (in case of a cold start)
                let waited = 0;
                while (!brain.ready) {
                    if (waited > 30000) {
                        res.statusCode = 503;
                        return res.end(JSON.stringify({ error: 'Brain not ready after 30s' }));
                    }
                    await sleep(500);
                    waited += 500;
                }

                console.log(`[API] Prompt: ${prompt.slice(0, 80)}...`);
                const result = await brain.sendPrompt(prompt);
                console.log(`[API] Reply: ${(result?.reply || '').slice(0, 80)}...`);

                res.end(JSON.stringify({ reply: result?.reply || null, status: result?.status }));

            } catch (err) {
                console.error('[API] Error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // ---- 404 for anything else ----
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found. Use POST /ask or GET /ready' }));
});

// ---- Boot sequence ----
(async () => {
    console.log('[Server] Starting brain (this opens a browser window)...');
    await brain.startBrain();

    server.listen(PORT, () => {
        console.log(`\n[Server] ✅ Ready! HTTP API listening on http://localhost:${PORT}`);
        console.log(`[Server]    POST /ask   { "prompt": "..." }  — ask a question`);
        console.log(`[Server]    GET  /ready                      — check if brain is up\n`);
    });
})();

// ---- Graceful shutdown ----
async function shutdown() {
    console.log('\n[Server] Shutting down...');
    server.close();
    process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
