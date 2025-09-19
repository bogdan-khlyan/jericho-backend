export default [
  {
    method: 'GET',
    path: '/employees',
    handler: 'controller.getEmployees',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/projects-structure',
    handler: 'controller.getProjectsStructure',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/global/config',
    handler: 'controller.getConfig',
    config: { auth: false },
  },
  {
    method: 'PATCH',
    path: '/global/config',
    handler: 'controller.patchConfig',
    config: { auth: false },
  },
]
