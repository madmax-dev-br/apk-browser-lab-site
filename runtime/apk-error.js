/** Shared across the VM and native providers without importing the interpreter. */
export class APKError extends Error {
  constructor(message, details = null) { super(message); this.name = 'APKError'; if (details) this.details = details; }
}
