import contentAPIRoutes from './content-api'
import voiceRoutes from './voice'

const routes = {
  'content-api': {
    type: 'content-api',
    routes: [
      ...contentAPIRoutes,
      ...voiceRoutes,
    ],
  },
}

export default routes
