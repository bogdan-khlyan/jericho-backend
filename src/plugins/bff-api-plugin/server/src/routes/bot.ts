export default [
  {
    method: 'POST',
    path: '/telegram/send-message',
    handler: 'bot.sendTelegramMessage',
    config: { auth: false },
  },
  {
    method: 'POST',
    path: '/telegram/send-document',
    handler: 'bot.sendTelegramDocument',
    config: { auth: false },
  },
  {
    method: 'POST',
    path: '/telegram/webhook',
    handler: 'bot.handleTelegramUpdate',
    config: { auth: false },
  },
]
