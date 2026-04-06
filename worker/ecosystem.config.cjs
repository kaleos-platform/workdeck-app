module.exports = {
  apps: [{
    name: 'workdeck-worker',
    script: 'npx',
    args: 'tsx src/index.ts',
    cwd: __dirname,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    watch: false,
  }],
}
