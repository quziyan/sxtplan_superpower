export type DispatchRequest = {
  predictionId: string
  paramsJson: Record<string, unknown>
}

export type DispatchAck = {
  externalId: string
  acceptedAt: string
}

export type CancelAck = {
  externalId: string
  cancelledAt: string
}

export type DispatchStatus = {
  externalId: string
  state: 'QUEUED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
}

export interface CameraAdapter {
  readonly key: string
  dispatch(req: DispatchRequest): Promise<DispatchAck>
  cancel(externalId: string, idempotencyKey: string): Promise<CancelAck>
  pollStatus(externalId: string): Promise<DispatchStatus>
  /** 模拟 / 测试用：adapter 内部当作 backend 反向签 webhook payload */
  signOutgoing?(rawBody: string): string
}
