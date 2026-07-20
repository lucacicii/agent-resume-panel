const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("This repository uses pnpm. Run `./pnpm install` from the repository root.");
  process.exit(1);
}
