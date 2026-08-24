export interface Ga4ContentEvaluationCycleView {
  id: string;
  baseEvaluationDate: string;
  cycleDays: number;
  evaluationHour: number;
  status: 'active' | 'paused' | 'completed';
  lastEvaluatedOn: string | null;
  lastSeenContentScore: number | null;
  nextEvaluationDate: string;
  lastNotificationStatus: 'sent' | 'skipped_no_email' | 'failed' | null;
  lastNotifiedAt: string | null;
}
