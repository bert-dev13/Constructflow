/** Contract roles: Engineer I–IV and Contractor */
export type Role =
  | 'engineer_1'
  | 'engineer_2'
  | 'engineer_3'
  | 'engineer_4'
  | 'contractor';

export interface User {
  id: string;
  email: string;
  role: Role;
  name: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  engineer_1: 'Engineer I',
  engineer_2: 'Engineer II',
  engineer_3: 'Engineer III',
  engineer_4: 'Engineer IV',
  contractor: 'Contractor',
};

export const ROLE_BADGES: Record<Role, string> = {
  engineer_1: 'E1',
  engineer_2: 'E2',
  engineer_3: 'E3',
  engineer_4: 'E4',
  contractor: 'CT',
};

export const VALID_ROLES: Role[] = [
  'engineer_1',
  'engineer_2',
  'engineer_3',
  'engineer_4',
  'contractor',
];

export function isValidRole(value: unknown): value is Role {
  return typeof value === 'string' && (VALID_ROLES as string[]).includes(value);
}

export const NO_ROLE_MESSAGE = 'Account role not assigned';

export const DEMO_ACCOUNTS_BY_ROLE: Record<
  Role,
  { email: string; password: string; name: string }[]
> = {
  contractor: [
    { email: 'constructflow.contractor.1@gmail.com', password: 'fortesting01', name: 'Contractor' },
  ],
  engineer_1: [
    { email: 'constructflow.engineerr1@gmail.com', password: 'fortesting01', name: 'Engineer I' },
  ],
  engineer_2: [
    { email: 'constructflow.engineerii@gmail.com', password: 'fortesting01', name: 'Engineer II' },
  ],
  engineer_3: [
    { email: 'constructflow.engineerIII@gmail.com', password: 'fortesting01', name: 'Engineer III' },
  ],
  engineer_4: [
    { email: 'constructflow.engineer4@gmail.com', password: 'fortesting01', name: 'Engineer IV' },
  ],
};

/** First configured account per role (backward compatible). */
export const DEMO_ACCOUNTS: Record<Role, { email: string; password: string; name: string }> = {
  engineer_1: DEMO_ACCOUNTS_BY_ROLE.engineer_1[0],
  engineer_2: DEMO_ACCOUNTS_BY_ROLE.engineer_2[0],
  engineer_3: DEMO_ACCOUNTS_BY_ROLE.engineer_3[0],
  engineer_4: DEMO_ACCOUNTS_BY_ROLE.engineer_4[0],
  contractor: DEMO_ACCOUNTS_BY_ROLE.contractor[0],
};

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export type ReportType = 'SWA' | 'STEWA' | 'IAR' | 'PROGRESS';
export type ReportStatus =
  | 'draft'
  | 'submitted'
  | 'with_engineer_2'
  | 'revision_requested'
  | 'with_engineer_3'
  | 'approved';

export interface PdmActivity {
  id: string;
  number: string;
  name: string;
  duration: number;
  /** Optional link to Pay Item Master (Item No. / Description source). */
  payItemId?: string;
  payItemVersion?: number;
  unit?: string;
  /** Optional 0-based Early Start day override (0 = first day). Null = use formula. */
  esOverride?: number | null;
  /**
   * When true, duration is auto-set so EF = project completion (from the main schedule).
   * Start still follows the selected predecessor. Visual branch only — does not drive project end.
   */
  extendToEnd?: boolean;
  es?: number;
  ef?: number;
  ls?: number;
  lf?: number;
  isCritical?: boolean;
  posX?: number;
  posY?: number;
}

export interface PdmDependency {
  id: string;
  fromId: string;
  toId: string;
  type: DependencyType;
  /** Days. Positive = lag; negative = lead. Default 0. */
  lag?: number;
}

export interface BarChartTaskSegment {
  startDay: number;
  endDay: number;
  type: 'active' | 'suspended' | 'resumed' | 'original';
}

export interface BarChartTask {
  id: string;
  index: number;
  name: string;
  startDay: number;
  endDay: number;
  actualEndDay?: number | null;
  /** True when total float is zero (LF−EF = 0 and LS−ES = 0). */
  isCritical?: boolean;
  /** Multi-segment schedule (e.g. active -> suspended -> resumed) on the same activity row */
  segments?: BarChartTaskSegment[];
  /** Optional suspension window on this task */
  suspension?: {
    startDay: number;
    endDay: number;
  } | null;
  /** Original unshifted start day for reference/comparison */
  originalStartDay?: number;
  /** Original unshifted end day for reference/comparison */
  originalEndDay?: number;
  /** PDM Item No. (e.g. '100(1)', 'Part A') */
  itemNo?: string;
  /** Canonical PDM Activity ID */
  activityId?: string;
  /** Linked Pay/Cost item ID */
  payItemId?: string;
}

export interface SCurvePoint {
  date: string;
  pointDate?: string;
  label?: string | null;
  periodLabel?: string | null;
  originalPlan: number | null;
  currentPlan: number | null;
  actual: number | null;
  variance?: number | null;
  targetAccomplishmentPct?: number | null;
  targetAccomplishmentPhp?: number | null;
  cumulativePct?: number | null;
  cumulativePhp?: number | null;
}

export interface ProgressReport {
  id: string;
  projectName: string;
  type: ReportType;
  period: string;
  status: ReportStatus;
  submittedBy: string;
  submittedAt: string;
  qrCode: string;
  comments?: string;
}
