export type PredictionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'COMPLETED' | 'EXPIRED'

const LABELS: Record<PredictionStatus, string> = {
  PROPOSED: '待批',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  DISPATCHED: '已调度',
  COMPLETED: '已完成',
  EXPIRED: '已过期',
}

export function Status({ value }: { value: PredictionStatus }) {
  return <span className={`status status--${value.toLowerCase()}`}>{LABELS[value]}</span>
}
