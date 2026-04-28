import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { createInterface, type Interface as RLInterface } from 'readline';
import { Command } from 'commander';
import { output } from '../output.js';
import { loadConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
import { runAgentTask } from '../agents/executor.js';
import {
  loadIdentityContent,
  loadLessonsContent,
  buildMemoryContext,
} from '../memory/inject.js';

const COPILOT_INSTRUCTIONS_FILE = '.github/copilot-instructions.md';

/** Auto-load .github/copilot-instructions.md if it exists and is not disabled. */
function loadInstructions(flag?: string, disabled = false): string | undefined {
  if (disabled) return undefined;
  const filePath = flag ?? COPILOT_INSTRUCTIONS_FILE;
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8').trim();
  return undefined;
}

/** Build an optional project-context preamble to prepend to both passes. */
function buildContextPreamble(namespace?: string): string {
  const identity = loadIdentityContent();
  const lessons  = loadLessonsContent('analyst');
  const memory   = namespace
    ? buildMemoryContext(namespace, undefined, undefined, identity, lessons)
    : '';

  // If buildMemoryContext was called it already includes identity + lessons.
  // If not, build the sections manually.
  if (memory) return memory;

  const sections: string[] = [];
  if (identity) sections.push(`## Project identity\n${identity}`);
  if (lessons)  sections.push(`## Lessons learned\n${lessons}`);
  return sections.length ? sections.join('\n\n') + '\n\n' : '';
}

const PASS1_PROMPT = `\
You are a specification analyst. Given a rough spec, determine if clarifying information \
is needed to produce a high-quality, token-efficient specification for an AI planning agent.

Rules:
- If questions are needed, output ONLY a JSON object: {"type":"questions","items":["q1","q2",...]}
- If the spec is clear enough to improve without clarification, output ONLY: {"type":"ready"}
- No surrounding text, no markdown fences, no explanation.

Spec to analyse:
`;

function buildPass2Prompt(raw: string, qanda: Array<{ q: string; a: string }>): string {
  let prompt = `\
You are a specification writer. Produce an improved, token-efficient version of the spec \
below for use by an AI planning agent. Goals: remove ambiguity, add missing context, ensure \
it is self-contained, structured, and scannable. Return ONLY the improved spec in markdown — \
no surrounding text, no preamble.

Original spec:
${raw}`;

  if (qanda.length > 0) {
    prompt += '\n\nClarifications provided:\n';
    for (const { q, a } of qanda) {
      prompt += `Q: ${q}\nA: ${a}\n`;
    }
  }
  return prompt;
}

function safeParseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
}

function ask(rl: RLInterface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

export function registerSpec(program: Command): void {
  program
    .command('spec [text]')
    .description('AI-powered spec refinement with interactive Q&A clarification')
    .option('-i, --input <file>', 'Read spec from file instead of positional argument')
    .option('-o, --output <file>', 'Write improved spec to file (default: stdout)')
    .option('--model <model>', 'Model override (defaults to config default)')
    .option('--memory-namespace <ns>', 'Inject stored facts from this namespace into the prompt')
    .option('--instructions <file>', 'Repo instructions file (default: auto-detects .github/copilot-instructions.md)')
    .option('--no-instructions', 'Disable auto-detection of copilot-instructions.md')
    .action(async (text: string | undefined, opts: {
      input?: string;
      output?: string;
      model?: string;
      memoryNamespace?: string;
      instructions?: string;
      noInstructions?: boolean;
    }) => {
      const config = loadConfig();
      const model  = opts.model ?? config.defaultModel ?? '';

      // Read raw spec
      let raw = text ?? '';
      if (opts.input) {
        try { raw = readFileSync(opts.input, 'utf-8'); }
        catch { output.error(`Cannot read file: ${opts.input}`); process.exit(1); }
      }
      if (!raw.trim()) {
        output.error('No spec provided — pass text directly or use --input <file>');
        process.exit(1);
      }

      // Build project context preamble (identity + lessons + optional memory facts)
      const preamble = buildContextPreamble(opts.memoryNamespace);
      const instructionsContent = loadInstructions(opts.instructions, opts.noInstructions);

      if (preamble) output.dim('  Injecting project context…');

      // Pass 1 — check whether clarifying questions are needed
      output.dim('  Analysing spec…');
      const pass1 = await runAgentTask(
        'analyst',
        preamble + PASS1_PROMPT + raw,
        { model, instructionsContent },
      );
      if (!pass1.success) {
        output.error(`Agent failed: ${pass1.error ?? 'unknown error'}`);
        await clientManager.shutdown();
        process.exit(1);
      }

      const qanda: Array<{ q: string; a: string }> = [];
      const parsed = safeParseJson(pass1.output);

      if (parsed?.type === 'questions' && Array.isArray(parsed.items) && parsed.items.length > 0) {
        const questions = parsed.items as string[];
        output.blank();
        output.info(`The agent has ${questions.length} clarifying question(s):`);
        output.blank();

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        for (let i = 0; i < questions.length; i++) {
          const answer = await ask(rl, `  Q${i + 1}: ${questions[i]}\n  A: `);
          qanda.push({ q: questions[i]!, a: answer });
        }
        rl.close();
        output.blank();
      }

      // Pass 2 — produce improved spec (preamble included again for full context)
      output.dim('  Generating improved spec…');
      const pass2 = await runAgentTask(
        'analyst',
        preamble + buildPass2Prompt(raw, qanda),
        { model, instructionsContent },
      );
      if (!pass2.success) {
        output.error(`Agent failed: ${pass2.error ?? 'unknown error'}`);
        await clientManager.shutdown();
        process.exit(1);
      }

      const improved = pass2.output.trim();

      if (opts.output) {
        const dir = dirname(opts.output);
        if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
        writeFileSync(opts.output, improved + '\n', 'utf-8');
        output.success(`Saved to ${opts.output}`);
      } else {
        process.stdout.write(improved + '\n');
      }

      await clientManager.shutdown();
      process.exit(0);
    });
}
