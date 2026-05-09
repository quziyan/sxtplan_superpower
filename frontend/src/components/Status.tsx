export type PredictionStatus = 'PROPOSED' | 'VALIDATED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'COMPLETED' | 'EXPIRED'

const LABELS: Record<PredictionStatus, string> = {
  PROPOSED: '待审',
  VALIDATED: '已推送',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  DISPATCHED: '已调度',
  COMPLETED: '已完成',
  EXPIRED: '已过期',
}

export function Status({ value }: { value: PredictionStatus }) {
  return <span className={`status status--${value.toLowerCase()}`}>{LABELS[value]}</span>
}
