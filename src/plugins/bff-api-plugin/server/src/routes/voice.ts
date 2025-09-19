export default [
  {
    method: 'POST',
    path: '/voice/ask',
    handler: 'voice.askVoice',
    config: {
      auth: false,
    },
  },
]
