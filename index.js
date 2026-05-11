require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');

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

function addWarning(userId, userTag, reason, type) {
  if (!warningHistory[userId]) warningHistory[userId] = { tag: userTag, offenses: [] };
  warningHistory[userId].tag = userTag;
  warningHistory[userId].offenses.push({ reason, type, date: new Date().toISOString() });
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
    addWarning(message.author.id, message.author.tag, `automod: message contained a banned word`, 'automod');
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
    const modCommands = ['ban', 'kick', 'warn', 'lookup', 'removewarning', 'purge', 'slowmode', 'lock', 'unlock', 'membercount', 'userinfo', 'banlist', 'kicklist', 'warnlist', 'unban'];

    if (!isMod(message.member) && modCommands.includes(command)) {
      return;
    }

    if (isMod(message.member)) {
      const errorEmbed = (msg) => new EmbedBuilder().setColor(EMBED_COLOR).setDescription(msg);

      if (command === 'warn') {
        const target = message.mentions.users.first();
        const targetId = target?.id || args[opalIndex + 2];
        const reason = target
          ? args.slice(opalIndex + 3).join(' ')
          : args.slice(opalIndex + 3).join(' ');
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan ⸝⸝ usage: opal warn @user reason`)] }); return; }
        if (!reason) { await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal warn @user reason`)] }); return; }
        const userTag = target?.tag || targetId;
        addWarning(targetId, userTag, reason, 'warn');
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
        addWarning(target.id, target.user.tag, `kicked: ${reason}`, 'kick');
        await sendLog(message.guild, 'kick', target.user, message.author, reason);
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'ban') {
        const target = message.mentions.members.first();
        const targetId = target?.id || args[opalIndex + 2];
        const reason = target
          ? args.slice(opalIndex + 3).join(' ')
          : args.slice(opalIndex + 3).join(' ');
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan ⸝⸝ usage: opal ban @user reason`)] }); return; }
        if (!reason) { await message.channel.send({ embeds: [errorEmbed(`please provide a reason nyan ⸝⸝ usage: opal ban @user reason`)] }); return; }
        try {
          await message.guild.bans.create(targetId, { reason });
          const userTag = target?.user.tag || targetId;
          addWarning(targetId, userTag, `banned: ${reason}`, 'ban');
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
        const record = warningHistory[targetId];
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
        const indexArg = target ? args[opalIndex + 3] : args[opalIndex + 3];
        const index = parseInt(indexArg) - 1;
        if (!targetId) { await message.channel.send({ embeds: [errorEmbed(`please mention a user or provide their id nyan ⸝⸝ usage: opal removewarning @user 2`)] }); return; }
        const record = warningHistory[targetId];
        if (!record || record.offenses.length === 0) {
          await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no history found for <@${targetId}> nyan`)] });
          return;
        }
        if (isNaN(index) || index < 0 || index >= record.offenses.length) {
          await message.channel.send({ embeds: [errorEmbed(`invalid offense number nyan ⸝⸝ usage: opal removewarning @user 2`)] });
          return;
        }
        record.offenses.splice(index, 1);
        await message.react(REACT_EMOJI);
        return;
      }

      if (command === 'banlist') {
        const banned = Object.entries(warningHistory).filter(([, r]) => r.offenses.some(o => o.type === 'ban'));
        if (banned.length === 0) { await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no banned users found nyan`)] }); return; }
        const list = banned.map(([id, r]) => `<@${id}> — ${r.offenses.filter(o => o.type === 'ban').length} ban(s)`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields({ name: '›゛ ban list', value: list })] });
        return;
      }

      if (command === 'kicklist') {
        const kicked = Object.entries(warningHistory).filter(([, r]) => r.offenses.some(o => o.type === 'kick'));
        if (kicked.length === 0) { await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no kicked users found nyan`)] }); return; }
        const list = kicked.map(([id, r]) => `<@${id}> — ${r.offenses.filter(o => o.type === 'kick').length} kick(s)`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).addFields({ name: '›゛ kick list', value: list })] });
        return;
      }

      if (command === 'warnlist') {
        const warned = Object.entries(warningHistory).filter(([, r]) => r.offenses.some(o => o.type === 'warn' || o.type === 'automod'));
        if (warned.length === 0) { await message.channel.send({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`no warned users found nyan`)] }); return; }
        const list = warned.map(([id, r]) => `<@${id}> — ${r.offenses.filter(o => o.type === 'warn' || o.type === 'automod').length} warning(s)`).join('\n');
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

client.login(process.env.TOKEN);