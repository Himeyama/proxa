#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createApp } from "./server.js";

const { port, baseURL, authType, defaultModel, providerName, global: globalListen } = config;
const hostname = globalListen ? "0.0.0.0" : "127.0.0.1";
const app = createApp();

serve({ fetch: app.fetch, port, hostname }, () => {
  const apiLabel =
    providerName === "responses" ? "Responses API" :
    providerName === "google" || providerName === "gemini" ? "Gemini API" :
    "Chat Completions";
  const displayHost = globalListen ? "0.0.0.0" : "localhost";
  console.log(`Anthropic → ${apiLabel} proxy listening on http://${displayHost}:${port}`);
  console.log(`  Provider:  ${providerName}`);
  if (baseURL) console.log(`  Upstream:  ${baseURL}`);
  console.log(`  Auth type: ${authType}`);
  if (defaultModel) console.log(`  Model:     ${defaultModel} (forced)`);
});
