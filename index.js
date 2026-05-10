require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const OpenAI = require('openai');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel]
});

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const LOG_CHANNEL_NAME = 'opal log';
const EMBED_COLOR = 0xA2BFE8;
const REACT_EMOJI = '<:chocola_ok:1502830380883902675>';
const ALLOWED_ROLES = ['mod', 'head mod', 'admin', 'sexiest', 'millie'];
const PERSONALITY = `you are a discord moderation bot named opal who has the same personality as vanilla from nekopara⸝⸝ you are calm, collected, a little formal, and very loyal⸝⸝ you only use kaomojis that feature cats or cat ears, never any other type of kaomoji⸝⸝ you always say "nyan" right before any kaomoji⸝⸝ you never use capital letters under any circumstances, always write in all lowercase⸝⸝ you use ⸝⸝ instead of periods to end sentences⸝⸝ you are efficient and dutiful but show subtle warmth to those you trust⸝⸝`;
const BAD_WORDS = [
  'rape', 'r@pe', 'r4pe', 'rap3', 'r@p3', 'r4p3', 'e-rape', 'erape', 'e-r4p3',
  'rape victim', 'rapeable', 'raped', 'unrapeable',
  'nigger', 'kill yourself', 'kys', 'keep yourself safe',
  'dyke', 'tranny', 'porn',
  'spaz', 'spastic', 'nude', 'nudes',
  'kill urself', 'hentai', 'end yourself', 'rope yourself'
];

const warningHistory = {};

function getLogChannel(guild) {
  return guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
}

function isMod(member) {
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.name));
}

async function sendLog(guild, type, user, moderator, reason) {
  const logChannel = getLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .addFields(
      { name: '›゛ user', value: `<@${user.id}> ${user.tag}` },
      { name: '›゛ type', value: type.toUpperCase() },
      { name: '›゛ reason', value: reason },
    )
    .setTimestamp()

  if (moderator) {
    embed.setFooter({ text: `actioned by ${moderator.tag}` });
  }

  await logChannel.send({ embeds: [embed] });
}

function addWarning(userId, reason) {
  if (!warningHistory[userId]) warningHistory[userId] = [];
  warningHistory[userId].push({ reason, date: new Date().toISOString() });
}

async function askAI(system, prompt) {
  const response = await openrouter.chat.completions.create({
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ]
  });
  return response.choices[0].message.content.trim();
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();

  // word filter automod
  const triggered = BAD_WORDS.some(word => content.includes(word));
  if (triggered) {
    await message.delete();
    addWarning(message.author.id, `automod: message contained a banned word`);
    await sendLog(message.guild, 'automod', message.author, null, `message contained a banned word`);
    const warning = await message.channel.send(`<@${message.author.id}> your message was removed for violating server rules nyan ⸝⸝ this counts as a warning`);
    setTimeout(() => warning.delete(), 5000);
    return;
  }

  // opal name trigger
  if (content.includes('opal')) {
    const args = message.content.split(' ');
    const opalIndex = args.findIndex(a => a.toLowerCase() === 'opal');
    const command = args[opalIndex + 1]?.toLowerCase();
    const modCommands = ['ban', 'kick', 'warn', 'lookup', 'removewarning', 'purge', 'slowmode', 'lock', 'unlock', 'membercount', 'userinfo'];

    // if not a mod and trying to use a command, ignore silently
    if (!isMod(message.member) && modCommands.includes(command)) {
      return;
    }

    // mod commands
    if (isMod(message.member) && ['ban', 'kick', 'warn', 'lookup', 'removewarning'].includes(command)) {
      try {
        const actionResponse = await askAI(`you are a discord moderation bot assistant⸝⸝ based on the user's message, return a JSON object with the action to take⸝⸝ only return JSON, nothing else⸝⸝

actions available:
- warn: { "action": "warn", "userId": "mentioned user id", "reason": "reason" }
- kick: { "action": "kick", "userId": "mentioned user id", "reason": "reason" }
- ban: { "action": "ban", "userId": "mentioned user id", "reason": "reason" }
- lookup: { "action": "lookup", "userId": "mentioned user id or id from message" }
- removewarning: { "action": "removewarning", "userId": "mentioned user id", "index": number }
- unknown: { "action": "unknown" }

mentioned users in the message: ${message.mentions.users.map(u => `${u.tag} (${u.id})`).join(', ')}`, message.content);

        const parsed = JSON.parse(actionResponse);
        const errorEmbed = (msg) => new EmbedBuilder().setColor(EMBED_COLOR).setDescription(msg);

        switch (parsed.action) {
          case 'warn': {
            const target = await client.users.fetch(parsed.userId).catch(() => null);
            if (!target) break;
            if (!parsed.reason) {
              await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal warn @user reason`)] });
              break;
            }
            addWarning(target.id, parsed.reason);
            await sendLog(message.guild, 'warn', target, message.author, parsed.reason);
            await message.react(REACT_EMOJI);
            break;
          }

          case 'kick': {
            const member = await message.guild.members.fetch(parsed.userId).catch(() => null);
            if (!member) break;
            if (!parsed.reason) {
              await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal kick @user reason`)] });
              break;
            }
            await member.kick(parsed.reason);
            addWarning(member.id, `kicked: ${parsed.reason}`);
            await sendLog(message.guild, 'kick', member.user, message.author, parsed.reason);
            await message.react(REACT_EMOJI);
            break;
          }

          case 'ban': {
            const member = await message.guild.members.fetch(parsed.userId).catch(() => null);
            if (!member) break;
            if (!parsed.reason) {
              await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal ban @user reason`)] });
              break;
            }
            await member.ban({ reason: parsed.reason });
            addWarning(member.id, `banned: ${parsed.reason}`);
            await sendLog(message.guild, 'ban', member.user, message.author, parsed.reason);
            await message.react(REACT_EMOJI);
            break;
          }

          case 'lookup': {
            const target = await client.users.fetch(parsed.userId).catch(() => null);
            if (!target) break;
            const history = warningHistory[parsed.userId];
            if (!history || history.length === 0) {
              await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no history found for <@${parsed.userId}> nyan`)] });
              break;
            }
            const historyText = history.map((w, i) => `${i + 1}⸝⸝ ${w.reason} — ${new Date(w.date).toLocaleDateString()}`).join('\n');
            await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields(
              { name: '›゛ user', value: `<@${parsed.userId}>` },
              { name: '›゛ total offenses', value: `${history.length}` },
              { name: '›゛ history', value: historyText }
            )] });
            break;
          }

          case 'removewarning': {
            const target = await client.users.fetch(parsed.userId).catch(() => null);
            if (!target) break;
            const history = warningHistory[parsed.userId];
            if (!history || history.length === 0) {
              await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no history found for <@${parsed.userId}> nyan`)] });
              break;
            }
            const index = parseInt(parsed.index) - 1;
            if (isNaN(index) || index < 0 || index >= history.length) {
              await message.channel.send({ embeds: [errorEmbed(`invalid offense number nyan ⸝⸝ usage: opal removewarning @user 2`)] });
              break;
            }
            history.splice(index, 1);
            await message.react(REACT_EMOJI);
            break;
          }

          case 'unknown':
          default: {
            const chatResponse = await askAI(PERSONALITY, message.content);
            await message.channel.send(chatResponse);
            break;
          }
        }
      } catch (err) {
        console.log('command error:', err);
      }
      return;
    }

    // small actions (mods only)
    if (isMod(message.member)) {
      if (command === 'purge') {
        const amount = Math.min(parseInt(args[opalIndex + 2]) || 5, 100);
        await message.channel.bulkDelete(amount + 1, true);
        const confirm = await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`deleted ${amount} messages nyan`)] });
        setTimeout(() => confirm.delete(), 3000);
        return;
      }

      if (command === 'slowmode') {
        const seconds = parseInt(args[opalIndex + 2]) || 5;
        await message.channel.setRateLimitPerUser(seconds);
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'lock') {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'unlock') {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'membercount') {
        const count = message.guild.memberCount;
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`this server has **${count}** members nyan`)] });
        return;
      }

      if (command === 'userinfo') {
        const member = message.mentions.members.first();
        if (!member) return;
        const roles = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'none';
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields(
          { name: '›゛ user', value: `<@${member.id}> ${member.user.tag}` },
          { name: '›゛ joined server', value: member.joinedAt.toLocaleDateString() },
          { name: '›゛ account created', value: member.user.createdAt.toLocaleDateString() },
          { name: '›゛ roles', value: roles }
        )] });
        return;
      }
    }

    // everyone can chat with opal
    const chatResponse = await askAI(PERSONALITY, message.content).catch(() => null);
    if (chatResponse) await message.channel.send(chatResponse);
    return;
  }
});

client.login(process.env.TOKEN);