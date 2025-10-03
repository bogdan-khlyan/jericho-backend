import contentAPIRoutes from './content-api'
import voiceRoutes from './voice'
import bot from "./bot";

const routes = {
  'content-api': {
    type: 'content-api',
    routes: [
      ...contentAPIRoutes,
      ...voiceRoutes,
      ...bot,
    ],
  },
}

export default routes
