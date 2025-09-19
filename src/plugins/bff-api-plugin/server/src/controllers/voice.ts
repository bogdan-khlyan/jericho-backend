import type { Core } from '@strapi/strapi'

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async askVoice(ctx) {
    try {
      const { files } = ctx.request
      if (!files || !files.file) {
        return ctx.badRequest('No file provided')
      }

      const file = files.file
      const buffer = await strapi
        .plugin('bff-api-plugin')
        .service('voice')   // 👈 теперь у тебя service = voice.ts
        .askVoice(file)

      ctx.set('Content-Type', 'audio/wav')
      ctx.body = Buffer.from(buffer)
    } catch (err) {
      strapi.log.error('[bff] askVoice error:', err)
      ctx.throw(500, 'Internal Server Error')
    }
  },
})
