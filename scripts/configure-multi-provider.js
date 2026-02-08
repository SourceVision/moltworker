#!/usr/bin/env node
/**
 * Configure multiple AI Gateway providers in OpenClaw config
 *
 * This script adds Anthropic and OpenAI models via Cloudflare AI Gateway
 * to the OpenClaw config, allowing `/model <name>` to switch between them.
 *
 * Requires environment variables:
 *   CF_AI_GATEWAY_ACCOUNT_ID: Cloudflare account ID
 *   CF_AI_GATEWAY_GATEWAY_ID: AI Gateway ID
 *   CLOUDFLARE_AI_GATEWAY_API_KEY: AI Gateway API key
 *   ANTHROPIC_API_KEY: (optional, used as fallback)
 *   OPENAI_API_KEY: (optional, used as fallback)
 */

const fs = require('fs');
const path = require('path');

const configPath = process.env.CONFIG_PATH || '/root/.openclaw/openclaw.json';

console.log('Loading config from:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

config.models = config.models || {};
config.models.providers = config.models.providers || {};

const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
const apiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;

if (!accountId || !gatewayId || !apiKey) {
    console.warn('Missing required env vars (ACCOUNT_ID, GATEWAY_ID, or API_KEY). Skipping multi-provider config.');
    process.exit(0);
}

// ============================================================
// ANTHROPIC PROVIDER
// ============================================================
const anthropicModels = [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200000, maxTokens: 16000 },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 16000 },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 16000 },
];

const anthropicBaseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic`;
config.models.providers['ai-gateway-anthropic'] = {
    baseUrl: anthropicBaseUrl,
    apiKey: apiKey,
    api: 'anthropic-messages',
    models: anthropicModels,
};
console.log(`Added ${anthropicModels.length} Anthropic models via AI Gateway`);

// ============================================================
// OPENAI PROVIDER
// ============================================================
const openaiModels = [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16000 },
    { id: 'o1', name: 'o1', contextWindow: 128000, maxTokens: 16000 },
    { id: 'o1-mini', name: 'o1 Mini', contextWindow: 128000, maxTokens: 16000 },
];

const openaiBaseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;
config.models.providers['ai-gateway-openai'] = {
    baseUrl: openaiBaseUrl,
    apiKey: apiKey,
    api: 'openai-completions',
    models: openaiModels,
};
console.log(`Added ${openaiModels.length} OpenAI models via AI Gateway`);

// ============================================================
// Set default model if not already set
// ============================================================
if (!config.agents?.defaults?.model) {
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.model = { primary: 'ai-gateway-anthropic/claude-sonnet-4-5-20250929' };
    console.log('Set default model to Claude Sonnet 4.5');
}

// ============================================================
// Write updated config
// ============================================================
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Multi-provider configuration applied successfully');
console.log('Available models can be switched with: /model <model-id>');
