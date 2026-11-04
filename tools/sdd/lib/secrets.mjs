// @ts-check

const SECRET_PATTERNS = [
  { name: 'github_pat_classic', regex: /ghp_[A-Za-z0-9]{20,}/g },
  { name: 'github_pat_fine_grained', regex: /github_pat_[A-Za-z0-9_]{40,}/g },
  { name: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'private_key', regex: /-----BEGIN (?:[A-Z0-9 ]+ )?KEY-----/g },
  { name: 'jwt_token', regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'openai_api_key', regex: /sk-[A-Za-z0-9_-]{24,}/g },
  { name: 'slack_token', regex: /xox[baprs]-[0-9A-Za-z-]{20,}/g },
];

/**
 * Scan string for potential secret leaks.
 * @param {string} text
 * @returns {{ hasSecret: boolean; matches: { pattern: string; redacted: string }[] }}
 */
export function scanSecrets(text) {
  if (!text || typeof text !== 'string') {
    return { hasSecret: false, matches: [] };
  }

  /** @type {{ pattern: string; redacted: string }[]} */
  const matches = [];

  for (const { name, regex } of SECRET_PATTERNS) {
    const rx = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = rx.exec(text)) !== null) {
      const full = match[0];
      // Redact: keep first 3 chars, mask the rest
      const redacted = full.length > 6 ? `${full.slice(0, 3)}...${full.slice(-3)}` : '***';
      matches.push({ pattern: name, redacted });
    }
  }

  return {
    hasSecret: matches.length > 0,
    matches,
  };
}
