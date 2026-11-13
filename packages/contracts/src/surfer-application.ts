/** App reads plus opt-in server-bound intake recovery. Learning still requires separate proof. */
export interface SurferApplicationReadPort {
  executionReadiness?(actor: unknown, input: unknown): Promise<unknown>;
  ask(actor: unknown, input: unknown): Promise<unknown>;
  catalog?(actor: unknown): Promise<unknown>;
  guidedAsk?(actor: unknown, input: unknown): Promise<unknown>;
  ruleCatalog?(actor: unknown): Promise<unknown>;
  guidedRuleAsk?(actor: unknown, input: unknown): Promise<unknown>;
  intakeStatus?(actor: unknown, input: unknown): Promise<unknown>;
  resumeIntake?(actor: unknown, input: unknown): Promise<unknown>;
}
