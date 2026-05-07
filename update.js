module.exports = {
  run: [{
    method: "shell.run",
    params: {
      message: "git pull"
    }
  }, {
    method: "shell.run",
    params: {
      path: "app/dashboard",
      message: "npm install --no-audit --no-fund --omit=dev"
    }
  }]
}
