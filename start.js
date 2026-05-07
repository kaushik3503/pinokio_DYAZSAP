module.exports = async (kernel) => {
  let port = await kernel.port()
  return {
    daemon: true,
    run: [
      {
        method: "shell.run",
        params: {
          env: {
            DASHBOARD_HOST: "127.0.0.1",
            DASHBOARD_PORT: port
          },
          path: "app/dashboard",
          message: [
            "node server.js"
          ],
          on: [{
            event: "/(http:\\/\\/[0-9.:]+)/",
            done: true
          }]
        }
      },
      {
        method: "local.set",
        params: {
          url: "{{input.event[1]}}"
        }
      }
    ]
  }
}
