// Role-based access control — PRD personas mapped to roles and fine-grained
// permissions. Every permission is enforced server-side in the API layer.

export const ROLES = [
  "RESEARCHER", // independent authorized researcher
  "APPSEC_LEAD", // enterprise AppSec lead
  "VALIDATOR", // security researcher / validator
  "PROGRAM_OWNER", // program owner
  "TENANT_ADMIN", // tenant administrator
  "AUDITOR", // security & compliance auditor
  "PLATFORM_OPERATOR", // platform operator (cross-tenant ops)
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:read",
  "org:admin",
  "program:read",
  "program:write",
  "scope:read",
  "scope:write",
  "scope:approve",
  "asset:read",
  "asset:write",
  "campaign:read",
  "campaign:write",
  "campaign:execute",
  "campaign:stop",
  "job:read",
  "identity:write",
  "test:propose",
  "test:approve",
  "finding:read",
  "finding:review",
  "report:write",
  "audit:read",
  "evidence:read",
  "platform:admin",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  RESEARCHER: [
    "org:read", "program:read", "scope:read", "asset:read", "asset:write",
    "campaign:read", "campaign:write", "campaign:execute", "job:read",
    "identity:write", "test:propose", "finding:read", "report:write", "evidence:read",
  ],
  APPSEC_LEAD: [
    "org:read", "program:read", "program:write", "scope:read", "scope:write",
    "asset:read", "asset:write", "campaign:read", "campaign:write", "campaign:execute",
    "job:read", "identity:write", "test:propose", "test:approve", "finding:read",
    "finding:review", "report:write", "evidence:read", "audit:read",
  ],
  VALIDATOR: [
    "org:read", "program:read", "scope:read", "asset:read", "campaign:read",
    "job:read", "finding:read", "finding:review", "report:write", "evidence:read",
    "test:approve", "audit:read",
  ],
  PROGRAM_OWNER: [
    "org:read", "program:read", "program:write", "scope:read", "scope:write",
    "scope:approve", "asset:read", "campaign:read", "campaign:stop", "job:read",
    "finding:read", "report:write", "audit:read",
  ],
  TENANT_ADMIN: [
    "org:read", "org:admin", "program:read", "program:write", "scope:read",
    "scope:write", "scope:approve", "asset:read", "asset:write", "campaign:read",
    "campaign:write", "campaign:execute", "campaign:stop", "job:read",
    "identity:write", "test:propose", "test:approve", "finding:read",
    "finding:review", "report:write", "audit:read", "evidence:read",
  ],
  AUDITOR: [
    "org:read", "program:read", "scope:read", "asset:read", "campaign:read",
    "job:read", "finding:read", "audit:read", "evidence:read",
  ],
  PLATFORM_OPERATOR: [
    "org:read", "org:admin", "program:read", "scope:read", "asset:read",
    "campaign:read", "campaign:stop", "job:read", "finding:read", "audit:read",
    "platform:admin",
  ],
};

export function roleHas(role: string | null | undefined, permission: Permission): boolean {
  if (!role || !isRole(role)) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

// Role families drive the two separated experiences:
//   finder     — bug-bounty hunters (researchers, leads, validators): the Workbench
//   governance — admins, owners, auditors, operators: the Admin Console
export type RoleFamily = "finder" | "governance";

const FINDER_ROLES: ReadonlySet<string> = new Set(["RESEARCHER", "APPSEC_LEAD", "VALIDATOR"]);

export function roleFamily(role: string | null | undefined): RoleFamily {
  if (role && FINDER_ROLES.has(role)) return "finder";
  return "governance"; // PROGRAM_OWNER, TENANT_ADMIN, AUDITOR, PLATFORM_OPERATOR, unknown
}
