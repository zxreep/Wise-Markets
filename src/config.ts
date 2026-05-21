import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  return value;
}, z.boolean());

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
  ENABLE_WEBSOCKET: booleanFromEnv.default(true)
});

export const config = envSchema.parse(process.env);
