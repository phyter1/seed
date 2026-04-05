/**
 * Template rendering for workload supervisor specs.
 *
 * Templates use `@@TOKEN@@` placeholders — pure string replacement, no
 * Jinja, no eval, no templating engine. Matches the existing seed
 * convention used for `com.seed.control-plane.plist.template`.
 *
 * Unknown tokens in the template are left untouched — they surface as
 * `@@FOO@@` in the rendered output, which fails loud when launchd
 * tries to load the plist.
 */

export type TemplateTokens = Record<string, string>;

/**
 * Replace every occurrence of `@@KEY@@` in `template` with the
 * corresponding value from `tokens`. Keys are case-sensitive.
 */
export function renderTemplate(
  template: string,
  tokens: TemplateTokens
): string {
  return template.replace(/@@([A-Z0-9_]+)@@/g, (match, key) => {
    const value = tokens[key];
    return value !== undefined ? value : match;
  });
}

/**
 * Expand `{{install_dir}}`-style placeholders inside a manifest env
 * value. Used to resolve manifest.env entries like
 *   "SEED_VEC_PATH": "{{install_dir}}/lib/vec0.dylib"
 * before those values are rendered into the supervisor template.
 */
export function expandEnvValue(
  value: string,
  tokens: TemplateTokens
): string {
  return value.replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, key) => {
    const upperKey = key.toUpperCase();
    const resolved = tokens[upperKey];
    return resolved !== undefined ? resolved : match;
  });
}

/**
 * Merge manifest.env (defaults) with declaration.env (operator
 * overrides). Operator values win. All {{token}} expansions happen
 * after the merge, so overrides can reference install_dir etc.
 */
export function resolveEnv(
  manifestEnv: Record<string, string> | undefined,
  declarationEnv: Record<string, string> | undefined,
  tokens: TemplateTokens
): Record<string, string> {
  const merged: Record<string, string> = {
    ...(manifestEnv ?? {}),
    ...(declarationEnv ?? {}),
  };
  const expanded: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    expanded[k] = expandEnvValue(v, tokens);
  }
  return expanded;
}

/**
 * Render an env map into a plist-compatible `<dict>` fragment that
 * can be substituted into a launchd template via the @@ENV@@ token.
 */
export function renderPlistEnvDict(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    // XML-escape the value (keys are [A-Z0-9_] so they don't need escaping)
    const escaped = v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    lines.push(`      <key>${k}</key>`);
    lines.push(`      <string>${escaped}</string>`);
  }
  return lines.join("\n");
}
