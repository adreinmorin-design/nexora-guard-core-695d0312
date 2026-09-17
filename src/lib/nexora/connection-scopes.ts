export const CONNECTION_SCOPES = {
  "requests:read": "Read request history and sanitized previews",
  "findings:read": "Read security findings",
  "policies:read": "Read governance policies",
  "model:invoke": "Run AI requests through policies and budgets (may incur provider charges)",
  "findings:resolve": "Resolve or reopen security findings",
} as const;
export type ConnectionScope = keyof typeof CONNECTION_SCOPES;
export const DEFAULT_CONNECTION_SCOPES: ConnectionScope[] = [
  "requests:read",
  "findings:read",
  "policies:read",
];
