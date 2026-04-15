import type { CreateMailboxResult, ScenarioDefinition } from '../types.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';

// Scenario loading stays as a tiny public helper so examples can import a
// stable function without depending on the engine method shape.
export function loadScenario(engine: EmailConnectEngine, definition: ScenarioDefinition): CreateMailboxResult[] {
  return engine.loadScenario(definition);
}
