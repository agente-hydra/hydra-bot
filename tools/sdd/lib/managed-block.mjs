// @ts-check

/**
 * Build begin/end tags for a managed block.
 * @param {string} [blockId]
 */
function getTags(blockId) {
  const idAttr = blockId ? ` id="${blockId}"` : '';
  const beginTag = `<!-- sdd:managed:begin${idAttr} -->`;
  const endTag = `<!-- sdd:managed:end${idAttr} -->`;
  // Fallback regex to match both with or without id
  const pattern = new RegExp(
    `<!--\\s*sdd:managed:begin(?:\\s+id=["']?${blockId || '[^"\'\\s>]*'}["']?)?\\s*-->([\\s\\S]*?)<!--\\s*sdd:managed:end(?:\\s+id=["']?${blockId || '[^"\'\\s>]*'}["']?)?\\s*-->`,
    'i'
  );
  return { beginTag, endTag, pattern };
}

/**
 * Check if content contains the specified managed block.
 * @param {string} content
 * @param {string} [blockId]
 * @returns {boolean}
 */
export function hasManagedBlock(content, blockId) {
  if (!content) return false;
  const { pattern } = getTags(blockId);
  return pattern.test(content);
}

/**
 * Read the inner content of a managed block.
 * @param {string} content
 * @param {string} [blockId]
 * @returns {string | null}
 */
export function readManagedBlock(content, blockId) {
  if (!content) return null;
  const { pattern } = getTags(blockId);
  const match = content.match(pattern);
  return match ? match[1] : null;
}

/**
 * Replace or append a managed block in content while preserving external content byte-for-byte.
 * @param {string} content
 * @param {string} newInnerContent
 * @param {string} [blockId]
 * @returns {string}
 */
export function writeManagedBlock(content, newInnerContent, blockId) {
  const { beginTag, endTag, pattern } = getTags(blockId);
  const formattedInner = newInnerContent.startsWith('\n') ? newInnerContent : `\n${newInnerContent}`;
  const trimmedFormatted = formattedInner.endsWith('\n') ? formattedInner : `${formattedInner}\n`;
  const replacement = `${beginTag}${trimmedFormatted}${endTag}`;

  if (pattern.test(content)) {
    return content.replace(pattern, replacement);
  }

  // Not found: append at end
  if (!content || content.trim().length === 0) {
    return `${replacement}\n`;
  }

  const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${replacement}\n`;
}
