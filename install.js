module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: "app/dashboard",
        message: [
          "npm install --no-audit --no-fund --omit=dev"
        ]
      }
    },
    {
      method: "notify",
      params: {
        html: "Dashboard installed. Add your Dynatrace and Azure OpenAI values to app/dashboard/.env, then click Start."
      }
    }
  ]
}
