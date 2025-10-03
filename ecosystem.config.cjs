module.exports = {
    apps: [
        {
            name: 'jericho-backend',
            script: 'npm',
            args: 'run start',
            env: {
                NODE_ENV: 'production',
                ENV_PATH: '.env.devserver',
                PORT: 5561,
                HOST: '0.0.0.0'
            }
        }
    ]
}
