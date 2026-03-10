// brain.js — Launches the Electron/ChatGPT window and provides a simple
// sendPrompt(text) → response interface. Nothing Discord-specific here.
//
// Any file that needs AI responses just does:
//   const { startBrain, sendPrompt } = require('./brain');
//   await startBrain();
//   const reply = await sendPrompt('Hello!');

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const electron = require('electron');

let ipcClient = null;
let ready = false;
const responseMap = new Map(); // tracks in-flight prompts by ID

// ---- Timestamped logging ----
(() => {
    const fmt = () => new Date().toISOString();
    const wrap = fn => (...args) => fn(`[${fmt()}]`, ...args);
    console.log = wrap(console.log);
    console.error = wrap(console.error);
    console.warn = wrap(console.warn);
})();

// ---- Start the Electron process ----
// Spawns the Electron window (which opens ChatGPT), then connects to its
// IPC server and waits for the READY signal before resolving.
function startBrain() {
    return new Promise((resolve, reject) => {
        const brainPath = path.join(__dirname, '../electron/main.js'); // no change needed — relative path still correct
        const proc = spawn(electron, [brainPath], { stdio: ['pipe', 'pipe', 'pipe'] });

        proc.stdout.on('data', (d) => {
            const str = d.toString();
            process.stdout.write(`[Brain] ${str}`);

            // Electron prints "IPC_PORT:12345" — grab the port and connect
            const m = str.match(/IPC_PORT:(\d+)/);
            if (m && !ipcClient) {
                const port = parseInt(m[1], 10);

                ipcClient = net.createConnection(port, '127.0.0.1', () => {
                    console.log('[Brain] IPC connected, waiting for READY...');
                });

                ipcClient.setEncoding('utf8');
                ipcClient.on('data', (data) => {
                    const lines = data.toString().split('\n').filter(Boolean);
                    for (const line of lines) {
                        if (line === 'READY') {
                            ready = true;
                            console.log('[Brain] Brain fully ready!');
                            resolve(); // startBrain() promise resolves here
                        } else {
                            handleResponse(line);
                        }
                    }
                });

                ipcClient.on('error', (e) => console.error('[Brain] IPC error', e));
            }
        });

        proc.stderr.on('data', (d) => process.stderr.write(`[Brain stderr] ${d.toString()}`));
        proc.on('exit', (code) => {
            ready = false;
            console.log(`[Brain] Electron exited with code ${code}`);
        });
    });
}

// ---- Handle a response coming back from Electron ----
function handleResponse(data) {
    try {
        const msg = JSON.parse(data.replace(/^RESULT:/, ''));
        if (msg.id && responseMap.has(msg.id)) {
            const resolve = responseMap.get(msg.id);
            resolve(msg.result);
            responseMap.delete(msg.id);
        }
    } catch { /* malformed line, ignore */ }
}

// ---- Send a prompt and get the response ----
// Returns a promise that resolves to the AI's reply string.
// Usage: const reply = await sendPrompt('What is 2+2?');
function sendPrompt(prompt) {
    return new Promise((resolve) => {
        if (!ready) return resolve({ status: 'NOT_READY' });

        const id = 'id_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        responseMap.set(id, resolve);

        try {
            ipcClient.write(JSON.stringify({ id, prompt }) + '\n');
        } catch (e) {
            responseMap.delete(id);
            resolve({ status: 'IPC_ERROR', error: e.message });
        }
    });
}

module.exports = {
    startBrain,
    sendPrompt,
    get ready() { return ready; }
};
