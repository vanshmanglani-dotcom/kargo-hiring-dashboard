export type Role = 'PM' | 'SPM';
export const ROLES: Role[] = ['PM', 'SPM'];
export type EmailKind = 'invite' | 'reject';
export type Decision = 'auto' | EmailKind;

export interface Criterion {
  role: Role;
  name: string;
  description: string;
  weight: number;
  source?: string | null;
  position: number;
}

export interface CriterionScore {
  name: string;
  weight: number;
  score: number; // 0-5
  reason: string;
}

export interface RoleScore {
  total: number; // 0-100
  criteria: CriterionScore[];
}

export interface Candidate {
  id: string;
  created_at: string;
  file_name: string | null;
  applied_role: Role;
  status: 'processing' | 'scored' | 'error';
  error: string | null;
  cv_content: string | null;
  scores: Record<Role, RoleScore> | null;
  pm_score: number | null;
  spm_score: number | null;
  decision: Decision;
  brief: string | null;
  email_kind: EmailKind | null;
  email_subject: string | null;
  email_body: string | null;
  email_edited: boolean;
  sent_at: string | null;
  sent_to: string | null;
  sent_message_id: string | null;
}

export interface PII {
  candidate_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** What the dashboard receives: candidate + PII + computed ranking. */
export interface CandidateView extends Candidate {
  name: string | null;
  email: string | null;
  phone: string | null;
  rank: number | null; // rank within applied role (1 = best)
  recommended: EmailKind | null; // what the system recommends from the ranking
  outcome: EmailKind | null; // recommended unless the founder overrode it
  draft_stale: boolean; // draft missing or made for the other outcome
}
