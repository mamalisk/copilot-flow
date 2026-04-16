/**
 * Terminal output utilities: colour, spinners, tables, and structured logging.
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let currentLevel: LogLevel =
  (process.env.COPILOT_FLOW_LOG_LEVEL as LogLevel | undefined) ?? 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel];
}

// ─── Core log functions ───────────────────────────────────────────────────────

export const output = {
  debug: (msg: string) => {
    if (shouldLog('debug')) console.log(chalk.gray(`[debug] ${msg}`));
  },
  info: (msg: string) => {
    if (shouldLog('info')) console.log(chalk.blue('ℹ') + ' ' + msg);
  },
  success: (msg: string) => {
    if (shouldLog('info')) console.log(chalk.green('✓') + ' ' + msg);
  },
  warn: (msg: string) => {
    if (shouldLog('warn')) console.warn(chalk.yellow('⚠') + ' ' + chalk.yellow(msg));
  },
  error: (msg: string) => {
    if (shouldLog('error')) console.error(chalk.red('✗') + ' ' + chalk.red(msg));
  },
  /** Print a line without any prefix — for raw output. */
  print: (msg: string) => {
    if (shouldLog('info')) console.log(msg);
  },
  /** Print a dimmed/secondary line. */
  dim: (msg: string) => {
    if (shouldLog('info')) console.log(chalk.dim(msg));
  },
  /** Print a section header. */
  header: (title: string) => {
    if (shouldLog('info')) {
      console.log('');
      console.log(chalk.bold(chalk.cyan(title)));
      console.log(chalk.cyan('─'.repeat(Math.min(title.length + 4, 60))));
    }
  },
  /** Print a blank line. */
  blank: () => {
    if (shouldLog('info')) console.log('');
  },
};

// ─── Retry progress reporter ──────────────────────────────────────────────────

/** Default onRetry callback for CLI commands — logs retry attempt to stderr. */
export function logRetry(error: Error, attempt: number, nextDelayMs: number): void {
  output.warn(
    `Retry ${attempt} after ${nextDelayMs}ms — ${error.message.slice(0, 80)}`
  );
}

// ─── Simple key-value table ───────────────────────────────────────────────────

export function printTable(rows: Array<[string, string]>): void {
  if (!shouldLog('info')) return;
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(
      chalk.dim(key.padEnd(maxKey + 2)) + value
    );
  }
}

// ─── Spinner wrapper (async) ──────────────────────────────────────────────────

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>
): Promise<T> {
  // Use dynamic import for ESM-only ora
  const { default: ora } = await import('ora');
  const spinner = ora(text).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

// ─── Agent name generator ─────────────────────────────────────────────────────

const ADJECTIVES = [
  'agile', 'apt', 'bold', 'brave', 'bright', 'brisk', 'calm', 'crisp',
  'deft', 'deep', 'eager', 'fierce', 'fleet', 'keen', 'lean', 'lucid',
  'nimble', 'pure', 'quick', 'sharp', 'stoic', 'sure', 'swift', 'true',
  'vivid', 'wise', 'wry', 'zeal',
];

/**
 * Famous people themed per agent type — used as the noun half of generated names.
 * Each list is long enough to avoid collisions in most parallel runs.
 */
const TYPE_NAMES: Record<string, string[]> = {
  coder:                ['Ada', 'Turing', 'Knuth', 'Hopper', 'Linus', 'Ritchie', 'Dijkstra', 'Lovelace', 'Wozniak', 'Stroustrup'],
  researcher:           ['Darwin', 'Curie', 'Feynman', 'Sagan', 'Hawking', 'Bohr', 'Faraday', 'Pasteur', 'Franklin', 'Hubble'],
  tester:               ['Deming', 'Juran', 'Crosby', 'Ishikawa', 'Shewhart', 'Taguchi', 'Myers', 'Bach', 'Kaner', 'Whittaker'],
  reviewer:             ['Socrates', 'Kant', 'Voltaire', 'Russell', 'Popper', 'Aristotle', 'Hume', 'Locke', 'Peirce', 'Dewey'],
  architect:            ['Wright', 'Gaudi', 'Hadid', 'Gehry', 'Piano', 'Foster', 'Kahn', 'Saarinen', 'Utzon', 'Niemeyer'],
  analyst:              ['Euler', 'Gauss', 'Bayes', 'Laplace', 'Fourier', 'Markov', 'Poisson', 'Pascal', 'Leibniz', 'Ramanujan'],
  documenter:           ['Orwell', 'Asimov', 'Tolkien', 'Twain', 'Hemingway', 'Feynman', 'Sagan', 'Knuth', 'Tufte', 'Strunk'],
  debugger:             ['Holmes', 'Poirot', 'Marple', 'Morse', 'Columbo', 'Spade', 'Marlowe', 'Vance', 'Wolfe', 'Wimsey'],
  coordinator:          ['Nelson', 'Marshall', 'Eisenhower', 'Wellington', 'Nimitz', 'Slim', 'Macarthur', 'Patton', 'Montgomery', 'Bradley'],
  optimizer:            ['Ohno', 'Toyota', 'Goldratt', 'Taylor', 'Shannon', 'Neumann', 'Watt', 'Babbage', 'Ford', 'Deming'],
  'security-auditor':   ['Shannon', 'Diffie', 'Hellman', 'Rivest', 'Shamir', 'Adleman', 'Schneier', 'Zimmermann', 'Bernstein', 'Mitnick'],
  'performance-engineer': ['Carnot', 'Rankine', 'Kelvin', 'Watt', 'Newton', 'Lorentz', 'Mach', 'Tesla', 'Joule', 'Faraday'],
};

const FALLBACK_NAMES = ['Sage', 'Pixel', 'Cipher', 'Atlas', 'Echo', 'Nova', 'Orbit', 'Prism', 'Helix', 'Quark'];

/**
 * Generate a memorable, unique-ish name for an agent instance.
 * Format: `{adjective}-{Name}` themed to the agent's role.
 * Examples: `swift-Ada`, `keen-Darwin`, `bold-Holmes`, `eager-Euler`.
 */
export function generateAgentName(agentType: string): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const pool = TYPE_NAMES[agentType] ?? FALLBACK_NAMES;
  const name = pool[Math.floor(Math.random() * pool.length)];
  return `${adj}-${name}`;
}

// ─── Agent status badge ───────────────────────────────────────────────────────

export function agentBadge(type: string): string {
  const colours: Record<string, typeof chalk.blue> = {
    coder: chalk.blue,
    researcher: chalk.cyan,
    tester: chalk.green,
    reviewer: chalk.yellow,
    architect: chalk.magenta,
    coordinator: chalk.white,
    analyst: chalk.cyan,
    debugger: chalk.red,
    documenter: chalk.gray,
    optimizer: chalk.yellow,
    'security-auditor': chalk.red,
    'performance-engineer': chalk.magenta,
  };
  const colour = colours[type] ?? chalk.white;
  return colour(`[${type}]`);
}
