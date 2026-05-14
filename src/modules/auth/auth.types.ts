export interface GatewayClaims {
  userId: string;
  orgId?: string;
  tenantId?: string;
  roles: string[];
  email?: string;
  raw: Record<string, unknown>;
}
