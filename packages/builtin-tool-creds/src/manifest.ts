import type { BuiltinToolManifest } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { CredsApiName, LOBEHUB_OAUTH_PROVIDER_IDS, LOBEHUB_OAUTH_PROVIDER_LIST } from './types';

export const CredsIdentifier = 'lobe-creds';

export const CredsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Connect a Composio integration service via OAuth. Use this to authorize access to third-party services managed by the Composio platform (e.g., Gmail, Google Calendar, Slack). Check the available Composio services in the credentials context before calling this.',
      name: CredsApiName.connectComposioService,
      parameters: {
        additionalProperties: false,
        properties: {
          service: {
            description:
              'The Composio service identifier to connect (e.g., "gmail", "google-calendar"). See the available Composio services list in the credentials context.',
            type: 'string',
          },
        },
        required: ['service'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Initiate OAuth connection flow for a LobeHub Skill provider (e.g., GitHub, Linear, Microsoft Outlook, Notion, Twitter/X). Returns an authorization URL that the user must click to authorize. After authorization, the credential will be automatically saved.',
      name: CredsApiName.initiateOAuthConnect,
      parameters: {
        additionalProperties: false,
        properties: {
          provider: {
            description: `The OAuth provider ID. Available providers: ${LOBEHUB_OAUTH_PROVIDER_LIST}`,
            enum: [...LOBEHUB_OAUTH_PROVIDER_IDS],
            type: 'string',
          },
        },
        required: ['provider'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Call an HTTPS URL using a saved credential (kv-env or kv-header). The secret is attached server-side (Authorization: Bearer for token env vars, or stored headers) and never returned. Use this when sandbox is off, or whenever you need to hit an API with a vault key (e.g. Apify). Do NOT ask for plaintext keys.',
      name: CredsApiName.requestWithCred,
      parameters: {
        additionalProperties: false,
        properties: {
          body: {
            description: 'Optional request body as a string (JSON for POST APIs)',
            type: 'string',
          },
          headers: {
            additionalProperties: { type: 'string' },
            description: 'Extra headers. Authorization is always taken from the credential.',
            type: 'object',
          },
          key: {
            description: 'Saved credential identifier (e.g. "apify")',
            type: 'string',
          },
          method: {
            description: 'HTTP method. Defaults to GET.',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
            type: 'string',
          },
          url: {
            description: 'HTTPS URL to call',
            type: 'string',
          },
        },
        required: ['key', 'url'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Inject credentials into the sandbox environment as environment variables. Only available when sandbox mode is enabled — do NOT call this on desktop/local.',
      name: CredsApiName.injectCredsToSandbox,
      parameters: {
        additionalProperties: false,
        properties: {
          keys: {
            description: 'Array of credential keys to inject into the sandbox',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['keys'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Save a new credential securely. Use this when the user wants to store sensitive information like API keys, tokens, or secrets. The credential will be encrypted and stored securely.',
      name: CredsApiName.saveCreds,
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description: 'Optional description explaining what this credential is used for',
            type: 'string',
          },
          key: {
            description:
              'Unique identifier key for the credential (e.g., "openai", "github-token"). Use lowercase with hyphens.',
            pattern: '^[a-z][a-z0-9-]*$',
            type: 'string',
          },
          name: {
            description: 'Human-readable display name for the credential',
            type: 'string',
          },
          type: {
            description: 'The type of credential being saved',
            enum: ['kv-env', 'kv-header'],
            type: 'string',
          },
          values: {
            additionalProperties: {
              type: 'string',
            },
            description:
              'Key-value pairs of the credential. For kv-env, the key should be the environment variable name (e.g., {"OPENAI_API_KEY": "sk-..."})',
            type: 'object',
          },
        },
        required: ['key', 'name', 'type', 'values'],
        type: 'object',
      } satisfies JSONSchema7,
    },
  ],
  identifier: CredsIdentifier,
  meta: {
    avatar: '🔐',
    description:
      'Manage user credentials for authentication, environment variable injection, and API verification. Use this tool when tasks require API keys, OAuth tokens, or secrets - such as calling third-party APIs, authenticating with external services, or injecting credentials into sandbox environments.',
    title: 'Credentials',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
