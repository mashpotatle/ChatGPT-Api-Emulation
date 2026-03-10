// main.js — Electron process that controls the ChatGPT browser window.
// It receives prompts over a local TCP socket (IPC) and sends back responses.
// Nothing Discord-specific lives here — it's just a "text in, text out" brain.

const { app, BrowserWindow, session } = require('electron');
const net = require('net');
const fs = require('fs');
const path = require('path');

// ---- Load system prompt (optional) ----
// Edit system_prompt.txt to change the AI's personality / instructions.
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt.txt');
let systemPrompt = '';
try {
    systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8').trim();
    console.log('[System] Loaded system prompt');
} catch {
    console.warn('[System] No system_prompt.txt found — starting with no system prompt');
}

// ---- Timestamped logging ----
(() => {
    const ts = () => new Date().toISOString();
    const wrap = fn => (...a) => fn(`[${ts()}]`, ...a);
    console.log = wrap(console.log);
    console.error = wrap(console.error);
    console.warn = wrap(console.warn);
})();

const sleep = ms => new Promise(r => setTimeout(r, ms));

let win;
let ready = false;
let currentResolve = null;
let bootstrapResolve = null;
let bootstrapping = true;
let bootLock = true;

// ---- DOM: type text into ChatGPT's input box ----
async function fastDomInsert(prompt) {
    return await win.webContents.executeJavaScript(`(function(){
        const sels = ['#prompt-textarea','div.ProseMirror[contenteditable="true"]','div[contenteditable="true"]'];
        let box = null;
        for(const s of sels){ const el=document.querySelector(s); if(el){box=el; break;} }
        if(!box) return {ok:false, reason:'no_box'};
        while(box.firstChild) box.removeChild(box.firstChild);
        const p=document.createElement('p');
        p.textContent = ${JSON.stringify(prompt)};
        box.appendChild(p);
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(box); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
        box.dispatchEvent(new InputEvent('input', {bubbles:true,cancelable:true,inputType:'insertText',data:${JSON.stringify(prompt)}}));
        return {ok:true};
    })()`);
}

// ---- DOM: press Enter to submit ----
async function sendNativeEnter() {
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char',    keyCode: '\r'    });
    win.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'Enter' });
}

// ---- DOM: read the last assistant message ----
async function readLastAssistant() {
    return await win.webContents.executeJavaScript(`(function(){
        const msgs = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
        if(msgs.length===0) return '';
        const last = msgs[msgs.length-1];
        const md = last.querySelector('.markdown, .prose, .markdown-body');
        return (md||last).innerText.trim();
    })()`);
}

// ---- Electron app boot ----
// Disable background throttling so Electron keeps running even when minimised
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(async () => {
    console.log('[Electron] Booting browser window...');

    win = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: { contextIsolation: true, devTools: true }
    });

    win.webContents.on('console-message', (_, __, m) => console.log('[Renderer]', m));

    // Navigate to ChatGPT
    await win.loadURL('https://chat.openai.com');
    win.webContents.openDevTools();
    await sleep(6000); // give the page time to load & log in

    // ---- Watch for ChatGPT's "response finished" network signal ----
    // ChatGPT hits this URL when it finishes generating a reply.
    // We hook it to know exactly when to read the answer.
    session.defaultSession.webRequest.onCompleted(
        { urls: ["https://chatgpt.com/backend-api/lat/r"] },
        async () => {
            try {
                if (!ready) return;

                // First-run: inject the system prompt and wait for the response
                if (bootstrapping) {
                    if (bootstrapResolve) {
                        bootstrapResolve();
                        bootstrapResolve = null;
                        bootstrapping = false;
                        bootLock = false;
                        console.log('[System] Bootstrap complete — brain ready!');
                        if (ipcSocket) ipcSocket.write('READY\n');
                    }
                    return;
                }

                // Normal prompt: read the reply and send it back over IPC
                if (ipcSocket && currentResolve) {
                    const reply = await readLastAssistant();
                    const resultObj = {
                        result: { status: reply ? 'OK' : 'NO_REPLY', reply }
                    };
                    currentResolve(resultObj);
                    currentResolve = null;
                    ipcSocket.write(JSON.stringify(resultObj) + '\n');
                }
            } catch (e) { console.error('[Response handler]', e); }
        }
    );

    ready = true;
    console.log('[Electron] Page ready');

    // Inject system prompt if one exists
    if (systemPrompt) {
        console.log('[System] Injecting system prompt...');
        await fastDomInsert(systemPrompt);
        await sendNativeEnter();
        await new Promise(resolve => bootstrapResolve = resolve);
    } else {
        bootstrapping = false;
        bootLock = false;
        if (ipcSocket) ipcSocket.write('READY\n');
    }
});

// ---- IPC server (local TCP socket) ----
// The brain.js wrapper connects here to send prompts and receive responses.
let ipcSocket = null;
const server = net.createServer(sock => {
    ipcSocket = sock;
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) enqueue(line);
        }
    });
    sock.on('close', () => ipcSocket = null);
});

// Port 0 = OS picks a free port automatically; the port number is printed so brain.js can connect
server.listen(0, '127.0.0.1', () =>
    console.log('IPC_PORT:' + server.address().port)
);

// ---- Prompt queue ----
// Prompts are queued so they're processed one at a time (ChatGPT is sequential)
const q = [];
let busy = false;

function enqueue(raw) {
    q.push(raw);
    if (!busy) runQueue();
}

async function runQueue() {
    busy = true;
    while (q.length) {
        const raw = q.shift();
        try { await handleOne(raw); }
        catch (e) { console.error('[Queue]', e); }
    }
    busy = false;
}

async function handleOne(raw) {
    let id, prompt;
    try {
        const j = JSON.parse(raw);
        id     = j.id     || `id_${Date.now()}`;
        prompt = j.prompt || '';
    } catch {
        id     = `id_${Date.now()}`;
        prompt = raw;
    }

    console.log('[Handle] Processing:', id);

    if (!ready || !prompt) {
        if (ipcSocket) ipcSocket.write(JSON.stringify({ id, status: 'NOT_READY' }) + '\n');
        return;
    }

    const ins = await fastDomInsert(prompt);
    if (!ins.ok) {
        if (ipcSocket) ipcSocket.write(JSON.stringify({ id, status: 'INSERT_FAIL' }) + '\n');
        return;
    }

    await sendNativeEnter();

    // Wait for the response handler above to call currentResolve
    const replyObj = await new Promise(resolve => currentResolve = resolve);
    console.log(`[Handle] Reply for ${id}:`, replyObj.result.reply?.slice(0, 80), '...');

    if (ipcSocket) {
        ipcSocket.write(JSON.stringify({ id, ...replyObj }) + '\n');
    }
}

process.on('uncaughtException',  e => console.error('[Fatal]', e));
process.on('unhandledRejection', e => console.error('[Fatal]', e));
