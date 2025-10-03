import type { Core } from '@strapi/strapi'

export default ({ strapi }: { strapi: Core.Strapi }) => ({

  async sendTelegramMessage(ctx) {
    try {
      const body = ctx.request.body;
      const result = await strapi
        .plugin('bff-api-plugin')
        .service('bot')
        .sendTelegramMessage(body);

      ctx.status = 200;
      ctx.body = result;
    } catch (error) {
      strapi.log.error('[bff] sendTelegramMessage controller error:', error);
      ctx.throw(500, 'Failed to send Telegram message');
    }
  },

  async sendTelegramDocument(ctx) {
    try {
      const body = ctx.request.body;
      const result = await strapi
        .plugin('bff-api-plugin')
        .service('bot')
        .sendTelegramDocument(body);

      ctx.status = 200;
      ctx.body = result;
    } catch (error) {
      strapi.log.error('[bff] sendTelegramDocument controller error:', error);
      ctx.throw(500, 'Failed to send Telegram document');
    }
  },

  async handleTelegramUpdate(ctx) {
    try {
      const update = ctx.request.body;
      const result = await strapi
        .plugin('bff-api-plugin')
        .service('bot')
        .handleTelegramUpdate(update);

      ctx.status = 200;
      ctx.body = result;
    } catch (error) {
      strapi.log.error('[bff] handleTelegramUpdate controller error:', error);
      ctx.throw(500, 'Failed to process Telegram update');
    }
  },
})
