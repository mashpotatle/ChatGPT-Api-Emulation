/**
 * registerCommands.js — Registers slash commands with Discord
 *
 * Run this ONCE after setup, or whenever you change the commands:
 *   node registerCommands.js
 *
 * Requires in .env:
 *   DISCORD_TOKEN=your_bot_token
 *   CLIENT_ID=your_bot_application_id   ← found in Discord Developer Portal
 */

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN not set in .env');
    process.exit(1);
}
if (!process.env.CLIENT_ID) {
    console.error('❌ CLIENT_ID not set in .env');
    console.error('   Find your Client/Application ID in the Discord Developer Portal');
    process.exit(1);
}

const commands = [
    // /setchannel — restrict bot to a specific channel
    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the channel the bot is allowed to respond in')
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('The channel to listen in')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    // /restart — restart via pm2
    new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot (requires pm2)'),

    // /getsystemprompt — download current system_prompt.txt
    new SlashCommandBuilder()
        .setName('getsystemprompt')
        .setDescription('Download the current system_prompt.txt (owner only)'),

    // /updatesystemprompt — replace system_prompt.txt by uploading a file
    new SlashCommandBuilder()
        .setName('updatesystemprompt')
        .setDescription('Upload a new system_prompt.txt (owner only)'),

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered successfully!');
        console.log('   Commands may take up to 1 hour to appear globally.');
        console.log('   To register instantly to one server, add GUILD_ID to .env');
        console.log('   and switch to Routes.applicationGuildCommands()');
    } catch (err) {
        console.error('❌ Failed to register commands:', err.message);
    }
})();
