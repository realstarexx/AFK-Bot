const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

module.exports = function setupRejoin(bot, options) {
  const low = Math.min(options['min-interval'], options['max-interval']);
  const high = Math.max(options['min-interval'], options['max-interval']);
  const timer = setTimeout(() => bot.quit(options.reason), randomBetween(low, high) * 60000);
  bot.once('end', () => clearTimeout(timer));
};
