import type { Core } from '@strapi/strapi'

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getEmployees(ctx: any) {
    try {
      const data = await strapi
        .plugin('bff-api-plugin')
        .service('service')
        .getEmployees()

      ctx.status = 200
      ctx.body = data
    } catch (error) {
      strapi.log.error('[bff] getEmployees controller error:', error)
      ctx.throw(500, 'Failed to fetch employees')
    }
  },

  async getProjectsStructure(ctx: any) {
    try {
      const data = await strapi
        .plugin('bff-api-plugin')
        .service('service')
        .getProjectsStructure()

      ctx.status = 200
      ctx.body = data
    } catch (error) {
      strapi.log.error('[bff] getProjectsStructure controller error:', error)
      ctx.throw(500, 'Failed to fetch projects structure')
    }
  },

  async getConfig(ctx) {
    const res = await strapi
      .plugin('bff-api-plugin')   // 🔑 тут тоже исправляем
      .service('service')
      .getGlobalConfig()
    ctx.body = res
  },

  async patchConfig(ctx) {
    const payload = ctx.request.body
    const res = await strapi
      .plugin('bff-api-plugin')   // 🔑 и тут тоже
      .service('service')
      .patchGlobalConfig(payload)
    ctx.body = res
  },
})

export default controller
