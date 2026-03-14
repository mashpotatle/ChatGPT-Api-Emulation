/**
 * discord.js — Discord bot entry point for ChatGPT-Api-Emulation
 *
 * HOW TO USE:
 *   1. Copy your .env file (see .env.example) and fill in your tokens
 *   2. npm install
 *   3. node discord.js           ← starts the bot
 *
 * First time setup — register slash commands once:
 *   node registerCommands.js
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const brain = require('./brain/brain');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'electron', 'system_prompt.txt');

// The channel the bot is allowed to talk in (set via /setchannel slash command)
// If blank, the bot responds to @mentions in ANY channel
let ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || '';

// Prevents messages from being processed before Electron is ready
let bootLock = true;

// ─────────────────────────────────────────────
//  Context memory
//  Stores the last MAX_CONTEXT messages per channel so the bot
//  has conversation history to pass along with each prompt
// ─────────────────────────────────────────────
const MAX_CONTEXT = 15;
const channelContexts = new Map(); // channelId → array of { author, content }

// Tracks which users are waiting to upload a new system_prompt.txt
const awaitingSystemPromptUpload = new Set();

// ─────────────────────────────────────────────
//  Discord client
// ─────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────
//  Ready event
// ─────────────────────────────────────────────
client.once('ready', () => {
    console.log(`[Discord] Bot online as ${client.user.tag}`);
    if (ALLOWED_CHANNEL_ID) {
        console.log(`[Discord] Restricted to channel: ${ALLOWED_CHANNEL_ID}`);
    } else {
        console.log('[Discord] No channel restriction — responding to @mentions everywhere');
    }
});

// ─────────────────────────────────────────────
//  Slash commands  (owner-only)
// ─────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.guild) return;

    // All slash commands are restricted to the server owner
    const ownerId = interaction.guild.ownerId;
    if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: '❌ Owner only command.', ephemeral: true });
    }

    // /setchannel — pick which channel the bot listens in
    if (interaction.commandName === 'setchannel') {
        const channel = interaction.options.getChannel('channel');
        ALLOWED_CHANNEL_ID = channel.id;

        // Persist to .env so it survives restarts
        let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
        if (env.match(/^ALLOWED_CHANNEL_ID=/m)) {
            env = env.replace(/^ALLOWED_CHANNEL_ID=.*/m, `ALLOWED_CHANNEL_ID=${channel.id}`);
        } else {
            env += `\nALLOWED_CHANNEL_ID=${channel.id}`;
        }
        fs.writeFileSync(ENV_PATH, env);

        return interaction.reply(`✅ Bot will now respond in <#${channel.id}>\nRestart recommended to reload .env.`);
    }

    // /restart — restarts via pm2 (useful if you're running with pm2)
    if (interaction.commandName === 'restart') {
        await interaction.reply('♻️ Restarting bot…');
        exec('pm2 restart stringbot', (err) => {
            if (err) console.error('[PM2] Restart failed:', err.message);
        });
        return;
    }

    // /getsystemprompt — sends the current system_prompt.txt as a file
    if (interaction.commandName === 'getsystemprompt') {
        if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
            return interaction.reply({ content: '❌ system_prompt.txt not found.', ephemeral: true });
        }
        return interaction.reply({
            content: '📄 Current system prompt:',
            files: [SYSTEM_PROMPT_PATH],
            ephemeral: true,
        });
    }

    // /updatesystemprompt — tells the bot to watch for an uploaded .txt file
    if (interaction.commandName === 'updatesystemprompt') {
        awaitingSystemPromptUpload.add(interaction.user.id);
        return interaction.reply({
            content: '📥 Send a message with **system_prompt.txt** attached. Filename must match exactly.',
            ephemeral: true,
        });
    }
});

// ─────────────────────────────────────────────
//  Message handler
// ─────────────────────────────────────────────
client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    // ── System prompt file upload ──────────────────
    if (awaitingSystemPromptUpload.has(msg.author.id)) {
        const attachment = msg.attachments.find(a => a.name === 'system_prompt.txt');
        if (attachment) {
            awaitingSystemPromptUpload.delete(msg.author.id);
            try {
                const res = await fetch(attachment.url);
                const text = await res.text();
                fs.writeFileSync(SYSTEM_PROMPT_PATH, text, 'utf8');
                return msg.reply('✅ system_prompt.txt updated! Restart the bot for it to take effect.');
            } catch (err) {
                return msg.reply('❌ Failed to save system_prompt.txt: ' + err.message);
            }
        }
    }

    // ── Channel restriction ────────────────────────
    if (ALLOWED_CHANNEL_ID && msg.channel.id !== ALLOWED_CHANNEL_ID) return;

    // ── Build / update context memory ─────────────
    // We record every message in the allowed channel, not just @mentions,
    // so the bot has real conversation history to work with
    if (!channelContexts.has(msg.channel.id)) channelContexts.set(msg.channel.id, []);
    const history = channelContexts.get(msg.channel.id);
    history.push({ author: msg.author.tag, content: msg.content });
    if (history.length > MAX_CONTEXT) history.shift();

    // ── Only respond to @mentions ──────────────────
    if (!msg.mentions.has(client.user)) return;

    // ── Boot lock ──────────────────────────────────
    if (bootLock || !brain.ready) {
        return msg.reply('⚠️ Still booting — give me a moment!');
    }

    // ── Strip the @mention from the prompt ────────
    const cleanPrompt = msg.content.replace(/<@!?(\d+)>/g, '').trim();
    if (!cleanPrompt) return;

    // ── Bundle prompt + conversation context ──────
    // This is what gets sent to ChatGPT via Electron
    const contextBlock = history.map(m => `${m.author}: ${m.content}`).join('\n');
    const fullPrompt = `QUESTION:\n${cleanPrompt}\n\nCONVERSATION CONTEXT:\n${contextBlock}`;

    // ── Typing indicator — keeps showing until we reply ───
    let typing = true;
    (async () => {
        while (typing) {
            try {
                await msg.channel.sendTyping();
                await sleep(4000); // Discord's typing indicator lasts ~5s, refresh every 4s
            } catch { break; }
        }
    })();

    // ── Send to brain and reply ────────────────────
    try {
        const res = await brain.sendPrompt(fullPrompt);
        await sleep(500); // small buffer to make sure response is fully assembled
        typing = false;

        const replyText = res?.reply || res?.result?.reply || 'No response from brain.';

        // Discord has a 2000 char message limit — split if needed
        if (replyText.length <= 2000) {
            await msg.reply(replyText);
        } else {
            // Send in chunks
            const chunks = replyText.match(/.{1,1990}/gs) || [];
            await msg.reply(chunks[0]);
            for (let i = 1; i < chunks.length; i++) {
                await msg.channel.send(chunks[i]);
            }
        }
    } catch (err) {
        typing = false;
        console.error('[Discord] Brain error:', err);
        await msg.reply('❌ Something went wrong getting a response.');
    }
});

// ─────────────────────────────────────────────
//  Graceful shutdown
// ─────────────────────────────────────────────
async function gracefulShutdown() {
    console.log('[Process] Shutting down...');
    try { await client.destroy(); } catch {}
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ─────────────────────────────────────────────
//  Network check — waits for internet before starting Electron
//  (useful if running on a server/Raspberry Pi that boots before network is up)
// ─────────────────────────────────────────────
async function waitForNetwork() {
    while (true) {
        try {
            await new Promise((resolve, reject) => {
                exec('ping -c1 discord.com', (err) => err ? reject(err) : resolve());
            });
            console.log('[Network] Online');
            break;
        } catch {
            console.log('[Network] Not ready, retrying in 5s...');
            await sleep(5000);
        }
    }
}

// ─────────────────────────────────────────────
//  Start everything
// ─────────────────────────────────────────────
(async () => {
    await waitForNetwork();
    client.login(process.env.DISCORD_TOKEN);
    await brain.startBrain();  // spawns Electron + connects to ChatGPT
    bootLock = false;
    console.log('[Discord] Brain ready — bot is fully online');
})();
