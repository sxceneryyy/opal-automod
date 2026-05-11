require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const https = require('https');
const { MongoClient } = require('mongodb');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel]
});

const LOG_CHANNEL_NAME = 'opal-log';
const EMBED_COLOR = 0xA2BFE8;
const REACT_EMOJI = '<:chocola_ok:1502830380883902675>';
const ALLOWED_ROLES = ['mod', 'head mod', 'admin', 'sexiest', 'millie'];
const BAD_WORDS = [
  'rape', 'r@pe', 'r4pe', 'rap3', 'r@p3', 'r4p3', 'e-rape', 'erape', 'e-r4p3',
  'rape victim', 'rapeable', 'raped', 'unrapeable',
  'nigger', 'kill yourself', 'kys', 'keep yourself safe',
  'dyke', 'tranny', 'porn',
  'spaz', 'spastic', 'nude', 'nudes',
  'kill urself', 'hentai', 'end yourself', 'rope yourself'
];

const lastSearch = {};
const searchOffset = {};

let db;

async function connectDB() {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db('opal');
  console.log('✅ Connected to MongoDB');
}

async function getRecord(userId) {
  return await db.collection('offenses').findOne({ userId });
}

async function addWarning(userId, userTag, reason, type) {
  await db.collection('offenses').updateOne(
    { userId },
    {
      $set: { tag: userTag },
      $push: { offenses: { reason, type, date: new Date().toISOString() } }
    },
    { upsert: true }
  );
}

async function removeWarning(userId, index) {
  const record = await getRecord(userId);
  if (!record) return false;
  record.offenses.splice(index, 1);
  await db.collection('offenses').updateOne(
    { userId },
    { $set: { offenses: record.offenses } }
  );
  return true;
}

async function getList(type) {
  const filter = type === 'warn'
    ? { 'offenses.type': { $in: ['warn', 'automod'] } }
    : { 'offenses.type': type };
  return await db.collection('offenses').find(filter).toArray();
}

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

function duckSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=0`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('failed to parse response'));
        }
      });
    }).on('error', reject);
  });
}

async function doSearch(query, offset = 0) {
  const data = await duckSearch(query);
  const results = [];

  if (data.AbstractText && data.AbstractText.length > 0) {
    results.push({
      snippet: data.AbstractText,
      url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
    });
  }

  for (const topic of data.RelatedTopics || []) {
    if (topic.Text && topic.FirstURL) {
      results.push({ snippet: topic.Text, url: topic.FirstURL });
    }
    if (results.length >= 8) break;
  }

  if (results.length === 0) {
    results.push({
      snippet: `here are some resources on ${query}`,
      url: `https://www.khanacademy.org/search?page_search_query=${encodeURIComponent(query)}`
    });
  }

  return results[offset] || results[results.length - 1] || null;
}

connectDB().then(() => {
  client.login(process.env.TOKEN);
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();

  // word filter automod
  const triggeredWord = BAD_WORDS.find(word => {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(content);
  });
  if (triggeredWord) {
    await message.delete();
    await addWarning(message.author.id, message.author.tag, `automod: used "${triggeredWord}"`, 'automod');
    await sendLog(message.guild, 'automod', message.author, null, `used "${triggeredWord}"`);
    const warning = await message.channel.send(`<@${message.author.id}> your message was removed for violating server rules nyan ⸝⸝ this counts as a warning`);
    setTimeout(() => warning.delete(), 5000);
    return;
  }

  // opal name trigger
  if (content.includes('opal')) {
    const args = message.content.split(' ');
    const opalIndex = args.findIndex(a => a.toLowerCase() === 'opal');
    const command = args[opalIndex + 1]?.toLowerCase();
    const modCommands = ['ban', 'kick', 'warn', 'lookup', 'removewarning', 'purge', 'slowmode', 'lock', 'unlock', 'membercount', 'userinfo', 'banlist', 'kicklist', 'warnlist', 'unban'];

    if (!isMod(message.member) && modCommands.includes(command)) {
      return;
    }

    if (command === 'search') {
      const query = args.slice(opalIndex + 2).join(' ');
      if (!query) {
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`what would you like me to search for? nyan ⸝⸝ usage: opal search [question]`)] });
        return;
      }
      try {
        const result = await doSearch(query, 0);
        if (!result) {
          await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`i couldn't find anything on that nyan ⸝⸝ try rephrasing your question`)] });
          return;
        }
        lastSearch[message.channel.id] = query;
        searchOffset[message.channel.id] = 1;
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(
          `›゛ here's what i found on: **${query}**\n\n${result.snippet}\n\n[read this for more info!](${result.url})\n\n*say \`opal elaborate\` or \`opal more help\` to dive deeper nyan*`
        )] });
      } catch {
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`something went wrong with the search nyan ⸝⸝ try again`)] });
      }
      return;
    }

    if (command === 'elaborate' || (command === 'more' && args[opalIndex + 2]?.toLowerCase() === 'help')) {
      const topic = lastSearch[message.channel.id];
      if (!topic) {
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`i don't have a topic to elaborate on nyan ⸝⸝ try \`opal search [question]\` first`)] });
        return;
      }
      try {
        const offset = searchOffset[message.channel.id] || 1;
        const result = await doSearch(topic, offset);
        if (!result) {
          await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`i've shared everything i found on **${topic}** nyan ⸝⸝ try a new search`)] });
          return;
        }
        searchOffset[message.channel.id] = offset + 1;
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(
          `›゛ here's more on: **${topic}**\n\n${result.snippet}\n\n[read this for more info!](${result.url})\n\n*say \`opal elaborate\` or \`opal more help\` for even more nyan*`
        )] });
      } catch {
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`something went wrong nyan ⸝⸝ try again`)] });
      }
      return;
    }

    if (isMod(message.member)) {
      const errorEmbed = (msg) => new EmbedBuilder().setColor(EMBED_COLOR).setDescription(msg);

      if (command === 'warn') {
        const target = message.mentions.users.first();
        const targetId = target?.id || args[opalIndex + 2];
        const reason = args.slice(opalIndex + 3).join(' ');
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan ⸝⸝ usage: opal warn @user reason`)] }); return; }
        if (!reason) { await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal warn @user reason`)] }); return; }
        const userTag = target?.tag || targetId;
        await addWarning(targetId, userTag, reason, 'warn');
        const fakeUser = target || { id: targetId, tag: targetId };
        await sendLog(message.guild, 'warn', fakeUser, message.author, reason);
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'kick') {
        const target = message.mentions.members.first();
        const reason = args.slice(opalIndex + 3).join(' ');
        if (!target) { await message.channel.send({ embeds: [errorEmbed(`please mention a user nyan ⸝⸝ usage: opal kick @user reason`)] }); return; }
        if (!reason) { await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal kick @user reason`)] }); return; }
        await target.kick(reason);
        await addWarning(target.id, target.user.tag, `kicked: ${reason}`, 'kick');
        await sendLog(message.guild, 'kick', target.user, message.author, reason);
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'ban') {
        const target = message.mentions.members.first();
        const targetId = target?.id || args[opalIndex + 2];
        const reason = args.slice(opalIndex + 3).join(' ');
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan ⸝⸝ usage: opal ban @user reason`)] }); return; }
        if (!reason) { await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal ban @user reason`)] }); return; }
        try {
          await message.guild.bans.create(targetId, { reason });
          const userTag = target?.user.tag || targetId;
          await addWarning(targetId, userTag, `banned: ${reason}`, 'ban');
          const fakeUser = target?.user || { id: targetId, tag: targetId };
          await sendLog(message.guild, 'ban', fakeUser, message.author, reason);
          await message.react(REACT_EMOJI);
        } catch (err) {
          await message.channel.send({ embeds: [errorEmbed(`could not ban that user nyan ⸝⸝ they may already be banned or the id is invalid`)] });
        }
        return;
      }

      if (command === 'unban') {
        const targetId = args[opalIndex + 2];
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please provide a user id nyan ⸝⸝ usage: opal unban 123456789`)] }); return; }
        try {
          await message.guild.bans.remove(targetId);
          await message.react(REACT_EMOJI);
          await sendLog(message.guild, 'unban', { id: targetId, tag: targetId }, message.author, 'unbanned');
        } catch (err) {
          await message.channel.send({ embeds: [errorEmbed(`could not unban that user nyan ⸝⸝ they may not be banned or the id is invalid`)] });
        }
        return;
      }

      if (command === 'lookup') {
        const target = message.mentions.users.first();
        const targetId = target?.id || args[opalIndex + 2];
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan`)] }); return; }
        const record = await getRecord(targetId);
        if (!record || record.offenses.length === 0) {
          await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no history found for <@${targetId}> nyan`)] });
          return;
        }
        const historyText = record.offenses.map((w, i) => `${i + 1}⸝⸝ ${w.reason} — ${new Date(w.date).toLocaleDateString()}`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields(
          { name: '›゛ user', value: `<@${targetId}>` },
          { name: '›゛ total offenses', value: `${record.offenses.length}` },
          { name: '›゛ history', value: historyText }
        )] });
        return;
      }

      if (command === 'removewarning') {
        const target = message.mentions.users.first();
        const targetId = target?.id || args[opalIndex + 2];
        const index = parseInt(target ? args[opalIndex + 3] : args[opalIndex + 3]) - 1;
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan ⸝⸝ usage: opal removewarning @user 2`)] }); return; }
        const record = await getRecord(targetId);
        if (!record || record.offenses.length === 0) {
          await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no history found for <@${targetId}> nyan`)] });
          return;
        }
        if (isNaN(index) || index < 0 || index >= record.offenses.length) {
          await message.channel.send({ embeds: [errorEmbed(`invalid offense number nyan ⸝⸝ usage: opal removewarning @user 2`)] });
          return;
        }
        await removeWarning(targetId, index);
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'banlist') {
        const banned = await getList('ban');
        if (banned.length === 0) { await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no banned users found nyan`)] }); return; }
        const list = banned.map(r => `<@${r.userId}> — ${r.offenses.filter(o => o.type === 'ban').length} ban(s)`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields({ name: '›゛ ban list', value: list })] });
        return;
      }

      if (command === 'kicklist') {
        const kicked = await getList('kick');
        if (kicked.length === 0) { await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no kicked users found nyan`)] }); return; }
        const list = kicked.map(r => `<@${r.userId}> — ${r.offenses.filter(o => o.type === 'kick').length} kick(s)`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields({ name: '›゛ kick list', value: list })] });
        return;
      }

      if (command === 'warnlist') {
        const warned = await getList('warn');
        if (warned.length === 0) { await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no warned users found nyan`)] }); return; }
        const list = warned.map(r => `<@${r.userId}> — ${r.offenses.filter(o => o.type === 'warn' || o.type === 'automod').length} warning(s)`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields({ name: '›゛ warn list', value: list })] });
        return;
      }

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

    // react when name is mentioned with no command
    await message.react(REACT_EMOJI);
  }
});