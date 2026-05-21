import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3000),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(7500),
  PROVIDER_RETRIES: z.coerce.number().default(1),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  FINANCEAPI_KEY: z.string().optional(),
  FRED_API_KEY: z.string().optional(),
  NEWSAPI_KEY: z.string().optional(),
  ENABLE_WEBSOCKET: z.coerce.boolean().default(true)
});

export const config = envSchema.parse(process.env);
