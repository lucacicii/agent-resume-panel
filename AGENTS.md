# AGENTS.md

- Call the user Master.
- Do not modify Java code.
- Do not apply this repository's extension build/install flow to other projects unless that project explicitly defines the same rule.
- After completing code changes for this VS Code extension, always run `npm run compile`.
- When the change affects extension contributions, menus, commands, views, activation events, or anything the installed extension must show in VS Code, also run `npm run install:local`.
- After `npm run install:local`, tell Master to run `Developer: Reload Window` in VS Code. The extension's own Refresh command only reloads session data; it does not reload `package.json` contribution points.
