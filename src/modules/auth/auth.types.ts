export interface GatewayClaims {
  userId: string;
  orgId?: string;
  roles: string[];
  email?: string;
  raw: Record<string, unknown>;
}
