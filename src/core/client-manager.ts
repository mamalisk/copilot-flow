/**
 * Singleton manager for the CopilotClient lifecycle.
 * Ensures the client is started once and stopped on process exit.
 */

import { CopilotClient } from '@github/copilot-sdk';
import { output } from '../output.js';

export class ClientManager {
  private client: CopilotClient | null = null;
  private started = false;

  /** Return the running CopilotClient, starting it lazily if needed. */
  async getClient(): Promise<CopilotClient> {
    if (this.client && this.started) {
      return this.client;
    }

    const token = process.env.GITHUB_TOKEN;

    this.client = new CopilotClient(
      token
        ? { githubToken: token }
        : { useLoggedInUser: true }
    );

    output.debug('Starting CopilotClient...');
    await this.client.start();
    this.started = true;
    output.debug('CopilotClient started.');

    // Register cleanup on exit
    process.once('exit', () => void this.shutdown());
    process.once('SIGINT', async () => { await this.shutdown(); process.exit(0); });
    process.once('SIGTERM', async () => { await this.shutdown(); process.exit(0); });

    return this.client;
  }

  /** Ping the client to verify connectivity. */
  async ping(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Gracefully stop all sessions and the client. */
  async shutdown(): Promise<void> {
    if (!this.client || !this.started) return;

    output.debug('Shutting down CopilotClient...');
    try {
      await this.client.stop();
    } catch {
      // Force stop if graceful fails
      try { await this.client.forceStop(); } catch { /* ignore */ }
    }
    this.started = false;
    this.client = null;
    output.debug('CopilotClient stopped.');
  }

  get isRunning(): boolean {
    return this.started && this.client !== null;
  }
}

/** Process-wide singleton. Import this everywhere you need a client. */
export const clientManager = new ClientManager();
