import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });

  if (process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "")}/health`;
    const ping = async () => {
      try {
        await fetch(pingUrl);
      } catch {
        /* keep-alive failure ignored */
      }
    };
    const timer = setInterval(ping, 14 * 60 * 1000);
    timer.unref?.();
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
