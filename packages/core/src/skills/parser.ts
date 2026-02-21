import type { Skill, SkillTrigger, TriggerType } from "@agentclaw/types";

/**
 * Convert a name string to kebab-case for use as a skill ID.
 */
function toKebabCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Simple YAML parser that supports the subset of YAML used in SKILL.md files.
 *
 * Supported constructs:
 *  - Top-level scalar values:  `key: value`
 *  - Array items with `- type: ...` style objects (triggers)
 *  - Array items with `- "string"` or `- string` style (patterns)
 *  - Inline arrays: `["a", "b", "c"]`
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (!topMatch) {
      i++;
      continue;
    }

    const key = topMatch[1];
    const inlineValue = topMatch[2].trim();

    // If value is on the same line (simple scalar or inline array)
    if (inlineValue) {
      result[key] = parseInlineValue(inlineValue);
      i++;
      continue;
    }

    // Value is on subsequent lines — collect array items
    i++;
    const items: unknown[] = [];

    while (i < lines.length) {
      const nextLine = lines[i];

      // If we hit a non-indented, non-empty line, it's a new top-level key
      if (
        nextLine.trim() !== "" &&
        !nextLine.startsWith(" ") &&
        !nextLine.startsWith("\t")
      ) {
        break;
      }

      // Skip empty lines within a block
      if (nextLine.trim() === "") {
        i++;
        continue;
      }

      // Array item: `  - something`
      const arrayItemMatch = nextLine.match(/^[ \t]+-\s+(.*)/);
      if (arrayItemMatch) {
        const itemContent = arrayItemMatch[1].trim();

        // Check if it's an object item like `type: keyword`
        const objMatch = itemContent.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (objMatch) {
          // It's an object — collect its properties
          const obj: Record<string, unknown> = {};
          obj[objMatch[1]] = parseInlineValue(objMatch[2].trim());

          // Look ahead for more properties at deeper indentation
          const itemIndent = nextLine.match(/^([ \t]+)-/)![1];
          i++;

          while (i < lines.length) {
            const propLine = lines[i];

            // Empty line — skip
            if (propLine.trim() === "") {
              i++;
              continue;
            }

            // Check if this line is a property of the current object
            // It should be indented deeper than the `- ` marker
            const propMatch = propLine.match(/^([ \t]+)(\w[\w-]*)\s*:\s*(.*)/);
            if (
              propMatch &&
              propMatch[1].length > itemIndent.length &&
              !propLine.trim().startsWith("-")
            ) {
              obj[propMatch[2]] = parseInlineValue(propMatch[3].trim());
              i++;
              continue;
            }

            break;
          }

          items.push(obj);
        } else {
          // Simple array item (string)
          items.push(parseInlineValue(itemContent));
          i++;
        }
      } else {
        // Indented line that's not an array item — could be a continuation
        i++;
      }
    }

    if (items.length > 0) {
      result[key] = items;
    }
  }

  return result;
}

/**
 * Parse an inline YAML value: quoted string, inline array, or bare string.
 */
function parseInlineValue(value: string): unknown {
  if (!value) return "";

  // Inline array: ["a", "b", "c"]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];

    // Split by comma, respecting quotes
    const items: string[] = [];
    let current = "";
    let inQuote: string | null = null;

    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];

      if (inQuote) {
        if (ch === inQuote) {
          inQuote = null;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ",") {
        items.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      items.push(current.trim());
    }

    return items;
  }

  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  return value;
}

/**
 * Parse a SKILL.md file and return a Skill object.
 *
 * The file format uses YAML frontmatter between `---` delimiters,
 * followed by markdown instructions.
 *
 * @param filePath  Absolute path to the SKILL.md file
 * @param content   File content as a string
 */
export function parseSkillFile(filePath: string, content: string): Skill {
  // Split frontmatter and body
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error(
      `Invalid SKILL.md format: missing frontmatter in ${filePath}`,
    );
  }

  const yamlContent = match[1];
  const instructions = match[2].trim();

  const meta = parseSimpleYaml(yamlContent);

  const name = String(meta.name ?? "");
  if (!name) {
    throw new Error(`SKILL.md missing 'name' in frontmatter: ${filePath}`);
  }

  const description = String(meta.description ?? "");

  // Parse triggers
  const rawTriggers = meta.triggers;
  const triggers: SkillTrigger[] = [];

  if (Array.isArray(rawTriggers)) {
    for (const raw of rawTriggers) {
      if (typeof raw === "object" && raw !== null) {
        const triggerObj = raw as Record<string, unknown>;
        const type = String(triggerObj.type ?? "keyword") as TriggerType;
        let patterns: string[] = [];

        if (Array.isArray(triggerObj.patterns)) {
          patterns = triggerObj.patterns.map(String);
        } else if (typeof triggerObj.patterns === "string") {
          patterns = [triggerObj.patterns];
        }

        const trigger: SkillTrigger = { type, patterns };
        if (triggerObj.confidence !== undefined) {
          trigger.confidence = Number(triggerObj.confidence);
        }

        triggers.push(trigger);
      }
    }
  }

  const id = toKebabCase(name);

  return {
    id,
    name,
    description,
    path: filePath,
    ...(triggers.length > 0 ? { triggers } : {}),
    instructions,
    enabled: true,
    useCount: 0,
  };
}
