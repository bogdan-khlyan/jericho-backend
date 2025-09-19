import type { Core } from '@strapi/strapi'
import { normalizeImage } from '../../../utils/nomalize-image'

const EMP_UID = 'api::employee.employee'
const PROJ_UID = 'api::project.project'
const GLOBAL_UID = 'api::global.global'

const shortName = (first?: string, last?: string) => {
  const f = (first || '').trim()
  const l = (last || '').trim()
  if (!f && !l) return ''
  if (!f) return l
  return `${f.charAt(0)}.${l}`.trim()
}

const normalizeDutyText = (d: any): string | null => {
  if (!d) return null
  if (typeof d === 'string') return d
  return d.text ?? d.title ?? d.name ?? d.value ?? null
}

const mapEmployee = (e: any) => {
  const id = e?.id ?? e?.documentId ?? null
  const chief = e?.chief
  const pid =
    chief
      ? typeof chief === 'object'
        ? chief.id ?? chief.documentId ?? null
        : chief
      : undefined

  const avatarObj = e?.avatar ? normalizeImage(e.avatar) : null
  const img = avatarObj?.url || '/avatar.png'

  const responsibilities = Array.isArray(e?.duties)
    ? e.duties.map(normalizeDutyText).filter(Boolean)
    : []

  return {
    id,
    ...(pid ? { pid } : {}),
    name: shortName(e?.first_name, e?.last_name),
    title: e?.position ?? null,
    img,
    tags: (e?.tags ? String(e.tags).split(',') : [])
      .map((t: string) => t.trim())
      .filter(Boolean),
    projects: e?.project ? [e.project] : [],
    responsibilities,
  }
}

const mapProject = (p: any) => {
  const id = p?.id ?? p?.documentId ?? null
  const name = p?.name ?? ''
  const avatarObj = p?.img ? normalizeImage(p.img) : null
  const img = avatarObj?.url || '/avatar.png'
  return {
    id,
    name,
    title: null,
    img,
    tags: ['project'],
    projects: name ? [name] : [],
    responsibilities: [],
  }
}

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getEmployees(): Promise<any[]> {
    const entries: any[] = await (strapi as any).documents(EMP_UID).findMany({
      limit: 2000,
      populate: {
        avatar: true,
        duties: true,
        chief: { fields: ['id', 'documentId'] },
      },
      status: 'published',
    })
    return (entries || []).map(mapEmployee)
  },

  async getProjectsStructure(): Promise<any[]> {
    const projects: any[] = await (strapi as any).documents(PROJ_UID).findMany({
      limit: 1000,
      populate: {
        img: true,
        leaders: {
          populate: {
            leader: {
              populate: {
                avatar: true,
                duties: true,
                chief: { fields: ['id', 'documentId'] },
              },
            },
            employees: {
              populate: {
                avatar: true,
                duties: true,
                chief: { fields: ['id', 'documentId'] },
              },
            },
          },
        },
      },
      status: 'published',
    })

    const result: any[] = []
    for (const p of projects || []) {
      const projectNode = mapProject(p)
      result.push(projectNode)

      const groups = Array.isArray(p?.leaders) ? p.leaders : []
      for (const group of groups) {
        const leader = group?.leader
        if (leader) {
          const leaderNode = mapEmployee(leader)
          leaderNode.id = leaderNode.id + 100000000
          leaderNode.pid = projectNode.id
          leaderNode.projects = projectNode.projects
          result.push(leaderNode)

          const emps = Array.isArray(group?.employees) ? group.employees : []
          for (const emp of emps) {
            const empNode = mapEmployee(emp)
            empNode.pid = leaderNode.id
            empNode.projects = projectNode.projects
            result.push(empNode)
          }
        }
      }
    }
    return result
  },

  // === GET global config (всегда отдаём опубликованную версию) ===
  async getGlobalConfig(): Promise<any> {
    const doc: any = await (strapi as any)
      .documents(GLOBAL_UID)
      .findFirst({ fields: ['id', 'documentId', 'peoples', 'projects'], status: 'published' })

    if (!doc) return { id: null, peoples: { nodes: [], edges: [] } }

    return {
      id: doc.id ?? doc.documentId ?? null,
      peoples: doc.peoples ?? { nodes: [], edges: [] },
      projects: doc.projects ?? { nodes: [], edges: [] },
    }
  },

// === PATCH global config (сохраняем {nodes, edges} в peoples и публикуем) ===
  async patchGlobalConfig(payload: {
    peoples: { nodes: any[]; edges: any[] },
    projects: { nodes: any[]; edges: any[] }
  }): Promise<any> {
    strapi.log.info(`[patchGlobalConfig] called`)
    strapi.log.info(`[patchGlobalConfig] incoming payload: ${JSON.stringify(payload, null, 2)}`)

    try {
      const current: any = await (strapi as any)
        .documents(GLOBAL_UID)
        .findFirst({ fields: ['id', 'documentId', 'peoples', 'projects'] })

      const data = {
        peoples: payload.peoples ?? { nodes: [], edges: [] },
        projects: payload.projects ?? { nodes: [], edges: [] },
      }

      if (current) {
        strapi.log.info(`[patchGlobalConfig] updating existing doc documentId=${current.documentId}`)
        await (strapi as any).documents(GLOBAL_UID).update({
          documentId: current.documentId,
          data,
        })
        await (strapi as any).documents(GLOBAL_UID).publish({
          documentId: current.documentId,
        })
      } else {
        strapi.log.info(`[patchGlobalConfig] creating new doc...`)
        const created = await (strapi as any).documents(GLOBAL_UID).create({ data })
        await (strapi as any).documents(GLOBAL_UID).publish({
          documentId: created.documentId,
        })
      }

      const updated: any = await (strapi as any).documents(GLOBAL_UID).findFirst({
        fields: ['id', 'documentId', 'peoples', 'projects'],
        status: 'published',
      })

      return {
        id: updated?.id ?? updated?.documentId ?? null,
        peoples: updated?.peoples ?? { nodes: [], edges: [] },
        projects: updated?.projects ?? { nodes: [], edges: [] },
      }
    } catch (err) {
      strapi.log.error(`[patchGlobalConfig] ERROR: ${err instanceof Error ? err.stack : JSON.stringify(err)}`)
      throw err
    }
  }


})

export default service
