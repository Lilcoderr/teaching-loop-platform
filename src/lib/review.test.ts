import { describe, expect, it } from 'vitest'
import { nextReviewDate } from './review'

describe('review schedule', () => {
  const start = new Date('2026-07-12T08:00:00.000Z')

  it('advances through the fixed review intervals', () => {
    expect(nextReviewDate(start, 0, true)).toEqual({
      nextStage: 1,
      dueAt: '2026-07-15T08:00:00.000Z',
    })
    expect(nextReviewDate(start, 2, true)).toEqual({
      nextStage: 3,
      dueAt: '2026-07-26T08:00:00.000Z',
    })
  })

  it('resets to one day after a failed review', () => {
    expect(nextReviewDate(start, 3, false)).toEqual({
      nextStage: 0,
      dueAt: '2026-07-13T08:00:00.000Z',
    })
  })

  it('caps a passed review at the final stage', () => {
    expect(nextReviewDate(start, 3, true).nextStage).toBe(3)
  })
})
