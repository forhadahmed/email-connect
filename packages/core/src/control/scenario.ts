import type { CreateMailboxResult, ScenarioDefinition } from '../types.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';

export function loadScenario(engine: EmailConnectEngine, definition: ScenarioDefinition): CreateMailboxResult[] {
  return engine.loadScenario(definition);
}
