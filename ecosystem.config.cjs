// /opt/org-structure/strapi/ecosystem.config.cjs
module.exports = {
    apps: [
        {
            name: 'org-structure-strapi',
            cwd: '/opt/org-structure/strapi',          // ОБЯЗАТЕЛЬНО!
            script: 'npm',
            args: 'start',
            env: {
                NODE_ENV: 'production',
                // чтобы не зависеть от .env, продублируем самое критичное
                HOST: '127.0.0.1',                       // безопаснее чем 0.0.0.0
                PORT: '5561',
                DATABASE_CLIENT: 'sqlite',
                DATABASE_FILENAME: '/opt/org-structure/strapi/storage/prod.db',
                NODE_OPTIONS: '--max-old-space-size=4096'
            },
            // опционально, но полезно:
            autorestart: true,
            watch: false,
            max_memory_restart: '600M',
            time: true,
        }
    ]
};
